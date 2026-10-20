import { ApiError } from '../../services/api-client.js';
import { h } from './dom.js';
import { describeError } from './messages.js';

/** Text value of a named form control; empty when it does not exist. */
export function value(form: HTMLFormElement, name: string): string {
  const control = form.elements.namedItem(name);
  // A radio group comes back as a list whose value is the checked option.
  return control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement ||
    control instanceof RadioNodeList
    ? control.value.trim()
    : '';
}

export function checked(form: HTMLFormElement, name: string): boolean {
  const control = form.elements.namedItem(name);
  return control instanceof HTMLInputElement && control.checked;
}

/** Values of all checked checkboxes with this name. */
export function checkedValues(form: HTMLFormElement, name: string): string[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`), (input) => input.value);
}

export function setValue(form: HTMLFormElement, name: string, text: string): void {
  const control = form.elements.namedItem(name);

  if (
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement
  ) {
    control.value = text;
  }
}

/** Marks a field as invalid with a message below it, as the styleguide's `.is-invalid` + `.form-error`. */
export function showFieldError(form: HTMLFormElement, name: string, message: string): boolean {
  // Checkbox groups such as "platforms" come back as a list; the message belongs to the group.
  const found = form.elements.namedItem(name);
  const control = found instanceof RadioNodeList ? found[0] : found;

  if (!(control instanceof HTMLElement)) {
    return false;
  }

  const id = `${form.id || 'form'}-${name}-error`;
  control.classList.add('is-invalid');
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', id);
  control.closest('.form-group')?.append(h('div', { class: 'form-error', id, 'data-field-error': true }, message));
  return true;
}

export function clearErrors(form: HTMLFormElement): void {
  for (const element of form.querySelectorAll('[data-field-error], [data-form-alert]')) {
    element.remove();
  }

  for (const control of form.querySelectorAll('.is-invalid')) {
    control.classList.remove('is-invalid');
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }
}

/**
 * Alert for errors that belong to no single field, at the top of the form's content: inside the body when the
 * form is itself a modal or a card, so that it never sits above their header.
 */
export function showFormError(form: HTMLFormElement, message: string): void {
  const container = form.querySelector<HTMLElement>(':scope > .modal-body, :scope > .card-body') ?? form;
  const alert = h(
    'div',
    { class: 'alert alert-danger', role: 'alert', 'data-form-alert': true },
    h('strong', {}, 'Das hat nicht geklappt'),
    message,
  );

  container.prepend(alert);
  // Long dialogs scroll; the message must be visible without searching for it.
  alert.scrollIntoView?.({ block: 'nearest' });
}

/** Disables the button and shows a spinner while the action runs (styleguide state "Loading"). */
export async function whileBusy<Result>(
  button: HTMLButtonElement | null,
  work: () => Promise<Result>,
): Promise<Result> {
  const original = button === null ? [] : Array.from(button.childNodes);

  // Styleguide state "Loading": the content is replaced by a spinner, the button keeps its size and colour.
  if (button !== null) {
    button.style.minWidth = `${button.offsetWidth}px`;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.replaceChildren(h('span', { class: 'spinner spinner-inline', role: 'status', 'aria-label': 'Lädt' }));
  }

  try {
    return await work();
  } finally {
    if (button !== null) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.replaceChildren(...original);
      button.style.minWidth = '';
    }
  }
}

export type Validation = Readonly<Record<string, string | null>>;

/**
 * Handles a form submit: runs the client-side checks, calls the action with the submit button busy and maps
 * API errors to the fields named in the response, or to an alert. Returns whether the action succeeded.
 */
export async function submit(
  form: HTMLFormElement,
  action: () => Promise<void>,
  validate: () => Validation = () => ({}),
): Promise<boolean> {
  clearErrors(form);

  const problems = Object.entries(validate()).filter((entry): entry is [string, string] => entry[1] !== null);

  for (const [name, message] of problems) {
    showFieldError(form, name, message);
  }

  if (problems.length > 0) {
    form.querySelector<HTMLElement>('.is-invalid')?.focus();
    return false;
  }

  try {
    await whileBusy(form.querySelector<HTMLButtonElement>('button[type="submit"]'), action);
    return true;
  } catch (error) {
    const shown =
      error instanceof ApiError &&
      error.issues.length > 0 &&
      error.issues.every((issue) => showFieldError(form, issue.path.split('.')[0] ?? '', 'Bitte prüfe diese Eingabe.'));

    showFormError(form, describeError(error));

    if (shown) {
      form.querySelector<HTMLElement>('.is-invalid')?.focus();
    }

    return false;
  }
}
