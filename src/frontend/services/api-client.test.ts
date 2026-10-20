import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeError, messageForCode } from '../scripts/core/messages.js';
import { apiError, fakeApi, respond, stubNavigation } from '../scripts/testing/page.js';
import { api, ApiError, withQuery } from './api-client.js';

describe('api client', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('leaves empty query parameters out', (): void => {
    expect(withQuery('/api/projects', { status: undefined, search: '', limit: 50, flag: false })).toBe(
      '/api/projects?limit=50&flag=false',
    );
    expect(withQuery('/api/projects')).toBe('/api/projects');
  });

  it('sends JSON and returns the parsed answer', async (): Promise<void> => {
    const calls = fakeApi({ 'POST /api/projects': { id: 'p1' }, 'POST /api/session/sign-out': respond(204) });

    await expect(api.post('/api/projects', { name: 'A' })).resolves.toEqual({ id: 'p1' });
    await expect(api.post('/api/session/sign-out')).resolves.toBeUndefined();
    expect(calls[0]).toEqual({ method: 'POST', path: '/api/projects', body: { name: 'A' } });
  });

  it('turns error bodies into API errors with German messages', async (): Promise<void> => {
    fakeApi({ 'PATCH /api/projects/p1': apiError(409, 'concurrent_modification', [{ path: 'name', message: 'x' }]) });

    const error = await api.patch('/api/projects/p1', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'concurrent_modification', issues: [{ path: 'name' }] });
    expect(describeError(error)).toContain('inzwischen von jemand anderem geändert');
    expect(describeError(new Error('boom'))).toBe(messageForCode('internal_error'));
    expect(messageForCode('something_new')).toBe('Die Aktion ist fehlgeschlagen.');
  });

  it('copes with failures that carry no JSON body', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('Bad Gateway', { status: 502 }))),
    );
    await expect(api.get('/api/projects')).rejects.toMatchObject({ code: 'internal_error' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    await expect(api.get('/api/projects')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });

  it('sends users without a session to the login page', async (): Promise<void> => {
    const navigation = stubNavigation();
    fakeApi({ 'GET /api/session': apiError(401, 'unauthenticated') });

    await expect(api.get('/api/session')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(navigation.targets).toEqual(['/login.html']);
  });
});
