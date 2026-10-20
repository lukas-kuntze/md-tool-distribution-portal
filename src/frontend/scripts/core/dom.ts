/**
 * DOM construction without `innerHTML`: every value from the API ends up as text, so no markup can be injected
 * through names, release notes or audit details.
 */
type Child = Node | string | number | null | undefined | false;

type Attributes = Readonly<Record<string, string | number | boolean | null | undefined>>;

export function h<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attributes: Attributes = {},
  ...children: readonly (Child | readonly Child[])[]
): HTMLElementTagNameMap[Tag] {
  const element = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }

    element.setAttribute(name, value === true ? '' : String(value));
  }

  append(element, children.flat());
  return element;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }

    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Replaces the content of an element. */
export function render(target: Element, ...children: readonly (Child | readonly Child[])[]): void {
  target.replaceChildren();
  append(target, children.flat());
}

/** The element for a selector; a missing element is a defect of the page, not a state to handle. */
export function required<Found extends Element = HTMLElement>(selector: string, root: ParentNode = document): Found {
  const found = root.querySelector<Found>(selector);

  if (found === null) {
    throw new Error(`Element fehlt: ${selector}`);
  }

  return found;
}

export function icon(name: string): HTMLSpanElement {
  return h('span', { class: 'material-icons-outlined', 'aria-hidden': 'true' }, name);
}

export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'primary';

export function badge(text: string, tone: Tone): HTMLSpanElement {
  return h('span', { class: `badge badge-${tone}` }, text);
}

export function loadingState(text = 'Wird geladen …'): HTMLDivElement {
  return h(
    'div',
    { class: 'loading-row', role: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    text,
  );
}

export function emptyState(iconName: string, title: string, text: string, ...actions: readonly Node[]): HTMLDivElement {
  return h(
    'div',
    { class: 'empty-state' },
    h('span', { class: 'material-icons-outlined empty-state-icon', 'aria-hidden': 'true' }, iconName),
    h('h3', { class: 'empty-state-title' }, title),
    h('p', { class: 'empty-state-text' }, text),
    actions.length > 0 ? h('div', { class: 'empty-state-actions' }, ...actions) : null,
  );
}

export function errorState(text: string, retry?: () => void): HTMLDivElement {
  const retryButton =
    retry === undefined ? null : h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, 'Erneut versuchen');

  retryButton?.addEventListener('click', retry ?? ((): void => undefined));

  return h(
    'div',
    { class: 'error-state', role: 'alert' },
    h('span', { class: 'material-icons-outlined error-state-icon', 'aria-hidden': 'true' }, 'error_outline'),
    h('h3', { class: 'error-state-title' }, 'Laden fehlgeschlagen'),
    h('p', { class: 'error-state-text' }, text),
    retryButton === null ? null : h('div', { class: 'error-state-actions' }, retryButton),
  );
}

export function alertBox(
  tone: 'success' | 'danger' | 'warning' | 'info',
  title: string,
  text: string,
  ...extra: readonly Child[]
): HTMLDivElement {
  return h(
    'div',
    { class: `alert alert-${tone}`, role: tone === 'danger' ? 'alert' : 'status' },
    h('strong', {}, title),
    text,
    ...extra,
  );
}

/** Table inside the styleguide's wrapper; `numeric` columns are right-aligned. */
export function dataTable(
  columns: readonly { readonly label: string; readonly numeric?: boolean; readonly hidden?: boolean }[],
  rows: readonly HTMLTableRowElement[],
): HTMLDivElement {
  return h(
    'div',
    { class: 'table-wrapper' },
    h(
      'table',
      { class: 'data-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          columns
            .filter((column) => column.hidden !== true)
            .map((column) =>
              h('th', { scope: 'col', class: column.numeric === true ? 'text-right' : null }, column.label),
            ),
        ),
      ),
      h('tbody', {}, rows),
    ),
  );
}

export function cell(
  content: Child | readonly Child[],
  options: { readonly numeric?: boolean } = {},
): HTMLTableCellElement {
  return h('td', { class: options.numeric === true ? 'text-right' : null }, content);
}

/** Search parameter of the current URL, e.g. the `id` of a detail page. */
export function queryParameter(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** Page numbers to show: first and last always, the current one with its neighbours, gaps as `null` (…). */
export function pageNumbers(current: number, count: number): (number | null)[] {
  const shown = [...new Set([0, current - 1, current, current + 1, count - 1])]
    .filter((page) => page >= 0 && page < count)
    .sort((left, right) => left - right);

  return shown.flatMap((page, index) => {
    const previous = shown[index - 1];
    // A single missing page is shown instead of an ellipsis that would hide just one number.
    if (previous === undefined || page - previous === 1) {
      return [page];
    }

    return page - previous === 2 ? [previous + 1, page] : [null, page];
  });
}

/**
 * Pagination of the styleguide: previous/next as icon buttons with `aria-label`, page numbers with the current
 * one marked by `aria-current="page"`, first and last page always reachable, gaps shortened with „…“. Buttons
 * instead of links, as the styleguide recommends for client-side navigation. Nothing is shown for a single page.
 */
export function pager(
  page: number,
  total: number,
  pageSize: number,
  onChange: (page: number) => void,
): HTMLElement | null {
  const count = Math.ceil(total / pageSize);

  if (count <= 1) {
    return null;
  }

  const item = (
    content: Node | string,
    target: number,
    attributes: Record<string, string | boolean>,
  ): HTMLButtonElement => {
    const disabled = attributes['aria-disabled'] === 'true';
    const element = h('button', { type: 'button', ...attributes }, content);

    if (!disabled && target !== page) {
      element.addEventListener('click', () => onChange(target));
    }

    return element;
  };
  const edge = (label: string, iconName: string, target: number, enabled: boolean): HTMLButtonElement =>
    item(icon(iconName), target, {
      class: `pagination-item${enabled ? '' : ' is-disabled'}`,
      'aria-label': label,
      ...(enabled ? {} : { 'aria-disabled': 'true', tabindex: '-1' }),
    });

  return h(
    'nav',
    { class: 'pagination pager', 'aria-label': 'Seitennavigation' },
    edge('Vorherige Seite', 'chevron_left', page - 1, page > 0),
    pageNumbers(page, count).map((number) =>
      number === null
        ? h('span', { class: 'pagination-ellipsis', 'aria-hidden': 'true' }, '…')
        : item(String(number + 1), number, {
            class: `pagination-item${number === page ? ' is-active' : ''}`,
            ...(number === page ? { 'aria-current': 'page' } : {}),
          }),
    ),
    edge('Nächste Seite', 'chevron_right', page + 1, page < count - 1),
  );
}

export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

/** Breadcrumb of the styleguide; the last entry is the current page and no link. */
export function renderBreadcrumb(target: Element, crumbs: readonly Crumb[]): void {
  render(
    target,
    h(
      'ol',
      { class: 'breadcrumb-list' },
      crumbs.map((crumb, index) =>
        h(
          'li',
          { class: 'breadcrumb-item' },
          index === crumbs.length - 1 || crumb.href === undefined
            ? h('span', { 'aria-current': index === crumbs.length - 1 ? 'page' : null }, crumb.label)
            : h('a', { href: crumb.href }, crumb.label),
        ),
      ),
    ),
  );
}

/** Runs the first load of a detail page: spinner, then content or an error state with retry. */
export async function loadPage(
  root: ParentNode,
  load: () => Promise<void>,
  describe: (error: unknown) => string,
): Promise<void> {
  const state = required('[data-page-state]', root);
  const content = required('[data-page-content]', root);

  render(state, loadingState());
  content.hidden = true;

  try {
    await load();
    render(state);
    content.hidden = false;
  } catch (error) {
    render(
      state,
      errorState(describe(error), () => void loadPage(root, load, describe)),
    );
  }
}
