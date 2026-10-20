import { readFileSync } from 'node:fs';
import path from 'node:path';

import { vi } from 'vitest';

import type { CurrentUserDto, GlobalCapabilitiesDto } from '../../../shared/types/api.js';
import { resetSession } from '../../services/session-service.js';

const frontend = path.resolve(import.meta.dirname, '../..');

/** Loads `pages/<name>.html` with its partials into the test document, as Vite would serve it. */
export function loadPage(name: string, url = `/${name}.html`): void {
  let html = readFileSync(path.join(frontend, 'pages', `${name}.html`), 'utf8');

  while (html.includes('<!-- @')) {
    html = html.replace(/<!-- @([a-z-]+) -->/g, (_marker, partial: string) =>
      readFileSync(path.join(frontend, 'partials', `${partial}.html`), 'utf8'),
    );
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html');

  for (const script of parsed.querySelectorAll('script')) {
    script.remove();
  }

  document.title = parsed.title;
  document.body.replaceChildren(...Array.from(parsed.body.childNodes, (node) => document.importNode(node, true)));

  for (const attribute of Array.from(document.body.attributes)) {
    document.body.removeAttribute(attribute.name);
  }

  for (const attribute of Array.from(parsed.body.attributes)) {
    document.body.setAttribute(attribute.name, attribute.value);
  }

  window.history.replaceState(null, '', url);
  resetSession();
}

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export type Handler = (call: Call) => unknown;

/** Response of a handler: plain values become 200 JSON, `respond(...)` sets status and body explicitly. */
export class Respond {
  public constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly headers: Readonly<Record<string, string>> = {},
  ) {}
}

export function respond(status: number, body: unknown = null, headers: Readonly<Record<string, string>> = {}): Respond {
  return new Respond(status, body, headers);
}

export function apiError(status: number, code: string, issues?: readonly { path: string; message: string }[]): Respond {
  return respond(status, { error: { code, message: code, ...(issues === undefined ? {} : { issues }) } });
}

/**
 * Replaces `fetch` with routes keyed by `METHOD /path` (query string included when the key has one, otherwise
 * ignored). Unknown routes answer 404, so a missing stub shows up as a failing expectation.
 */
/** Route table of `fakeApi`: a fixed answer or a `Handler` per `METHOD /path`. */
export type Routes = Record<string, unknown>;

export function fakeApi(routes: Routes): Call[] {
  const calls: Call[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init: RequestInit = {}): Promise<Response> => {
      const method = init.method ?? 'GET';
      const call: Call = {
        method,
        path: input,
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      const pathOnly = input.split('?')[0] ?? input;
      const route = routes[`${method} ${input}`] ?? routes[`${method} ${pathOnly}`];

      calls.push(call);

      const result: unknown =
        route === undefined
          ? respond(404, { error: { code: 'not_found', message: 'not found' } })
          : typeof route === 'function'
            ? (route as Handler)(call)
            : route;
      const response = result instanceof Respond ? result : respond(200, result);

      return Promise.resolve(
        new Response(response.status === 204 ? null : JSON.stringify(response.body), {
          status: response.status,
          headers: { 'content-type': 'application/json', ...response.headers },
        }),
      );
    }),
  );

  return calls;
}

export const ALL_CAPABILITIES: GlobalCapabilitiesDto = {
  createProjects: true,
  managePermissions: true,
  readAudit: true,
  manageStorage: true,
  manageSettings: true,
  purgeReleases: true,
  managesAnyPermissions: true,
  administers: true,
};

export function user(capabilities: Partial<GlobalCapabilitiesDto> = {}): CurrentUserDto {
  return {
    id: '0192f3a4-0000-7000-8000-000000000001',
    displayName: 'Ada Admin',
    login: 'ada',
    avatarUrl: null,
    capabilities: { ...ALL_CAPABILITIES, ...capabilities },
    preferences: { theme: 'system', startPage: 'dashboard' },
  };
}

/** Text of an element with collapsed whitespace, for readable expectations. */
export function textOf(selector: string): string {
  return (document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function click(selector: string | Element): void {
  const element = typeof selector === 'string' ? document.querySelector(selector) : selector;

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Nothing to click: ${typeof selector === 'string' ? selector : selector.tagName}`);
  }

  element.click();
}

export function type(selector: string, text: string): void {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);

  if (element === null) {
    throw new Error(`No field: ${selector}`);
  }

  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function submitForm(selector: string): void {
  const form = document.querySelector<HTMLFormElement>(selector);

  if (form === null) {
    throw new Error(`No form: ${selector}`);
  }

  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/** Navigation is not possible in the test document; the target is recorded instead. */
export function stubNavigation(): { readonly targets: string[] } {
  const targets: string[] = [];
  vi.spyOn(window.location, 'assign').mockImplementation((url: string | URL) => {
    targets.push(String(url));
  });
  return { targets };
}
