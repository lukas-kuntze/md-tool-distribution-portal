import { render, required } from '../core/dom.js';
import { whileBusy } from '../core/forms.js';
import { describeError } from '../core/messages.js';
import { appIcon } from './published-apps.js';
import { Toast } from './toast.js';

const MAX_ICON_BYTES = 512 * 1024;
const ICON_TYPES = ['image/png', 'image/jpeg'];

export interface IconActions {
  readonly upload: (file: File) => Promise<void>;
  readonly remove: () => Promise<void>;
}

/**
 * Icon field of applications and projects: preview, "Icon hochladen" and "Entfernen". Changes apply at once;
 * type and size are checked here for a quick answer, the server checks the content again.
 */
export function bindIconPicker(field: HTMLElement, actions: IconActions): void {
  const file = required<HTMLInputElement>('[data-icon-file]', field);
  const choose = required<HTMLButtonElement>('[data-action="choose-icon"]', field);
  const remove = required<HTMLButtonElement>('[data-action="remove-icon"]', field);

  choose.addEventListener('click', () => file.click());

  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    file.value = '';

    if (selected === undefined) {
      return;
    }

    if (!ICON_TYPES.includes(selected.type)) {
      Toast.show('danger', 'Icon nicht übernommen', 'Bitte wähle eine PNG- oder JPEG-Datei.');
      return;
    }

    if (selected.size > MAX_ICON_BYTES) {
      Toast.show('danger', 'Icon nicht übernommen', 'Das Icon darf höchstens 512 KB groß sein.');
      return;
    }

    void whileBusy(choose, async () => {
      try {
        await actions.upload(selected);
        Toast.show('success', 'Icon gespeichert');
      } catch (error) {
        Toast.show('danger', 'Icon nicht übernommen', describeError(error));
      }
    });
  });

  remove.addEventListener('click', () => {
    void whileBusy(remove, async () => {
      try {
        await actions.remove();
        Toast.show('success', 'Icon entfernt');
      } catch (error) {
        Toast.show('danger', 'Icon nicht entfernt', describeError(error));
      }
    });
  });
}

export function showIcon(field: HTMLElement, url: string | null): void {
  render(required('[data-icon-preview]', field), appIcon(url, 'lg'));
  required('[data-action="remove-icon"]', field).hidden = url === null;
}
