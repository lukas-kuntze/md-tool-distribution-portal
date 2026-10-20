import type { ApiErrorDto } from '../../shared/types/api.js';

export const LOGIN_PAGE = '/login.html';

/** A refused or failed API call, carrying the error code of the API (or `network_error`). */
export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues: readonly { readonly path: string; readonly message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Path with query parameters; empty values are left out. */
export function withQuery(path: string, query: Query = {}): string {
  const parameters = new URLSearchParams();

  for (const [name, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      parameters.set(name, String(value));
    }
  }

  const search = parameters.toString();
  return search === '' ? path : `${path}?${search}`;
}

/**
 * Calls the administration API with the session cookie. The API checks the `Origin` header of state-changing
 * calls, which the browser sets on its own for same-origin `fetch`. Without a session the user is sent to the
 * login page.
 */
export async function apiRequest<Result>(method: string, path: string, body?: unknown): Promise<Result> {
  const response = await send(method, path, body);
  return response.status === 204 ? (undefined as Result) : ((await response.json()) as Result);
}

/** One page of a list and the number of all matching entries (`X-Total-Count`). */
export interface Page<Entry> {
  readonly entries: Entry[];
  readonly total: number;
}

export async function apiPage<Entry>(path: string, query?: Query): Promise<Page<Entry>> {
  const response = await send('GET', withQuery(path, query));
  const entries = (await response.json()) as Entry[];
  const total = Number(response.headers.get('x-total-count') ?? entries.length);

  return { entries, total: Number.isFinite(total) ? total : entries.length };
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : {
              accept: 'application/json',
              // Files (e.g. icons) travel as raw body with their own type, everything else as JSON.
              'content-type': body instanceof Blob ? body.type || 'application/octet-stream' : 'application/json',
            },
      ...(body === undefined ? {} : { body: body instanceof Blob ? body : JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'The server could not be reached.');
  }

  if (response.status === 401) {
    window.location.assign(LOGIN_PAGE);
  }

  if (!response.ok) {
    const error = await readError(response);
    throw new ApiError(response.status, error.code, error.message, error.issues ?? []);
  }

  return response;
}

export const api = {
  get: <Result>(path: string, query?: Query): Promise<Result> => apiRequest<Result>('GET', withQuery(path, query)),
  post: <Result>(path: string, body: unknown = {}): Promise<Result> => apiRequest<Result>('POST', path, body),
  patch: <Result>(path: string, body: unknown): Promise<Result> => apiRequest<Result>('PATCH', path, body),
  put: <Result>(path: string, body: unknown): Promise<Result> => apiRequest<Result>('PUT', path, body),
  delete: <Result>(path: string, body: unknown): Promise<Result> => apiRequest<Result>('DELETE', path, body),
};

async function readError(response: Response): Promise<ApiErrorDto['error']> {
  try {
    const body = (await response.json()) as Partial<ApiErrorDto>;

    if (body.error !== undefined && typeof body.error.code === 'string') {
      return body.error;
    }
  } catch {
    // Not every failure has a JSON body, e.g. a proxy error page.
  }

  return { code: response.status >= 500 ? 'internal_error' : 'invalid_request', message: response.statusText };
}
