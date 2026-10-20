import type { ProjectDto } from '../../../shared/types/api.js';
import { NAME_MAX_LENGTH, SLUG_MAX_LENGTH, SLUG_PATTERN } from '../../../shared/constants/formats.js';
import { projects } from '../../services/project-service.js';
import { App } from '../core/app.js';
import { badge, cell, dataTable, emptyState, errorState, h, loadingState, render, required } from '../core/dom.js';
import { suggestSlug } from '../core/format.js';
import { setValue, submit, value, type Validation } from '../core/forms.js';
import { labelOf, STATUS_LABELS } from '../core/labels.js';
import { describeError } from '../core/messages.js';
import { Overlays } from './overlays.js';
import { appIcon } from './published-apps.js';
import { Toast } from './toast.js';

/** Project overview (`index.html`): active or archived projects and creating a new one. */
export const ProjectsPage = App.register('ProjectsPage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-projects-page]');

    if (root === null) {
      return;
    }

    const status = required<HTMLSelectElement>('[data-project-status]', root);
    const list = required('[data-project-list]', root);
    const form = required<HTMLFormElement>('#project-create-form');

    const load = async (): Promise<void> => {
      render(list, loadingState());

      try {
        const found = await projects.list(status.value === 'archived' ? 'archived' : 'active');
        render(list, projectTable(found, status.value === 'archived'));
      } catch (error) {
        render(
          list,
          errorState(describeError(error), () => void load()),
        );
      }
    };

    status.addEventListener('change', () => void load());
    bindSlugSuggestion(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void submit(
        form,
        async () => {
          const created = await projects.create({
            name: value(form, 'name'),
            slug: value(form, 'slug'),
            description: value(form, 'description'),
          });
          Overlays.close(form.closest('.modal-overlay'));
          Toast.show('success', 'Projekt angelegt', created.name);
          window.location.assign(`/project.html?id=${created.id}`);
        },
        () => validateNameAndSlug(form),
      );
    });

    await load();
  },
});

function projectTable(found: readonly ProjectDto[], archived: boolean): Node {
  if (found.length === 0) {
    return archived
      ? emptyState(
          'inventory_2',
          'Keine archivierten Projekte',
          'Archivierte Projekte erscheinen hier und lassen sich wiederherstellen.',
        )
      : emptyState(
          'folder_open',
          'Noch keine Projekte',
          'Lege ein Projekt an, um Anwendungen und ihre Releases zu verwalten.',
        );
  }

  return dataTable(
    [{ label: 'Projekt' }, { label: 'Slug' }, { label: 'Anwendungen', numeric: true }, { label: 'Status' }],
    found.map((project) => {
      const status = labelOf(STATUS_LABELS, project.status);

      return h(
        'tr',
        {},
        cell(
          h(
            'div',
            { class: 'app-heading' },
            appIcon(project.iconUrl, 'sm', 'folder'),
            h(
              'div',
              {},
              h('a', { href: `/project.html?id=${project.id}`, class: 'table-link' }, project.name),
              project.description === '' ? null : h('div', { class: 'text-muted' }, project.description),
            ),
          ),
        ),
        cell(h('code', {}, project.slug)),
        cell(project.applicationCount, { numeric: true }),
        cell(badge(status.text, status.tone)),
      );
    }),
  );
}

/** Proposes the slug from the name until the user edits the slug field (concept 7.3). */
export function bindSlugSuggestion(form: HTMLFormElement): void {
  const name = form.elements.namedItem('name');
  const slug = form.elements.namedItem('slug');

  if (!(name instanceof HTMLInputElement) || !(slug instanceof HTMLInputElement)) {
    return;
  }

  let edited = false;

  slug.addEventListener('input', () => {
    edited = slug.value !== '';
  });
  name.addEventListener('input', () => {
    if (!edited) {
      setValue(form, 'slug', suggestSlug(name.value));
    }
  });
  form.addEventListener('reset', () => {
    edited = false;
  });
}

export function validateNameAndSlug(form: HTMLFormElement): Validation {
  const name = value(form, 'name');
  const slug = value(form, 'slug');

  return {
    name:
      name === '' || name.length > NAME_MAX_LENGTH
        ? `Bitte gib einen Namen mit höchstens ${NAME_MAX_LENGTH} Zeichen an.`
        : null,
    slug:
      SLUG_PATTERN.test(slug) && slug.length <= SLUG_MAX_LENGTH
        ? null
        : 'Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche, höchstens 63 Zeichen.',
  };
}
