import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ApiErrorDto, ProjectDto } from '../../../../shared/types/api.js';
import { ADMIN_GITHUB_ID, createHttpFixture, json, type HttpFixture } from '../testing/http-fixture.js';

describe('project routes', (): void => {
  let fixture: HttpFixture;
  let admin: string;

  beforeEach(async (): Promise<void> => {
    fixture = await createHttpFixture();
    admin = await fixture.signIn(ADMIN_GITHUB_ID, 'admin');
  });

  afterEach(async (): Promise<void> => {
    await fixture.close();
  });

  async function createProject(slug = 'md-ambulant'): Promise<ProjectDto> {
    const response = await fixture.call(admin, {
      method: 'POST',
      url: '/api/projects',
      payload: { slug, name: 'MD Ambulant', description: 'Pflege' },
    });

    expect(response.statusCode).toBe(201);
    return json<ProjectDto>(response);
  }

  it('creates, lists and loads projects', async (): Promise<void> => {
    const project = await createProject();

    expect(project).toMatchObject({
      slug: 'md-ambulant',
      status: 'active',
      rowVersion: 1,
      capabilities: { update: true },
    });
    expect(json<ProjectDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/projects' }))).toHaveLength(1);
    expect(json<ProjectDto>(await fixture.call(admin, { method: 'GET', url: `/api/projects/${project.id}` })).id).toBe(
      project.id,
    );
  });

  it('updates with optimistic locking and archives and restores', async (): Promise<void> => {
    const project = await createProject();
    const url = `/api/projects/${project.id}`;

    const updated = await fixture.call(admin, {
      method: 'PATCH',
      url,
      payload: { name: 'MD Pflege', description: '', rowVersion: 1 },
    });
    const stale = await fixture.call(admin, {
      method: 'PATCH',
      url,
      payload: { name: 'Alt', description: '', rowVersion: 1 },
    });

    expect(json<ProjectDto>(updated)).toMatchObject({ name: 'MD Pflege', rowVersion: 2 });
    expect(stale.statusCode).toBe(409);
    expect(json<ApiErrorDto>(stale).error.code).toBe('concurrent_modification');

    const archived = await fixture.call(admin, { method: 'POST', url: `${url}/archive`, payload: { rowVersion: 2 } });
    expect(json<ProjectDto>(archived)).toMatchObject({ status: 'archived' });
    expect(
      json<ProjectDto[]>(await fixture.call(admin, { method: 'GET', url: '/api/projects?status=active' })),
    ).toEqual([]);

    const restored = await fixture.call(admin, { method: 'POST', url: `${url}/restore`, payload: { rowVersion: 3 } });
    expect(json<ProjectDto>(restored)).toMatchObject({ status: 'active', archivedAt: null });
  });

  it('rejects duplicate slugs and invalid input', async (): Promise<void> => {
    await createProject();

    const duplicate = await fixture.call(admin, {
      method: 'POST',
      url: '/api/projects',
      payload: { slug: 'md-ambulant', name: 'X' },
    });
    const invalid = await fixture.call(admin, {
      method: 'POST',
      url: '/api/projects',
      payload: { slug: 'Not A Slug', name: 'X' },
    });
    const missing = await fixture.call(admin, { method: 'POST', url: '/api/projects', payload: { name: 3 } });

    expect([duplicate.statusCode, invalid.statusCode, missing.statusCode]).toEqual([409, 422, 400]);
    expect(json<ApiErrorDto>(missing).error.issues?.map((issue) => issue.path)).toEqual(['slug', 'name']);
  });

  it('hides projects from users without access and refuses changes', async (): Promise<void> => {
    const project = await createProject();
    const user = await fixture.signIn('2000', 'octocat');

    expect(json<ProjectDto[]>(await fixture.call(user, { method: 'GET', url: '/api/projects' }))).toEqual([]);
    expect((await fixture.call(user, { method: 'GET', url: `/api/projects/${project.id}` })).statusCode).toBe(404);
    expect(
      (await fixture.call(user, { method: 'POST', url: '/api/projects', payload: { slug: 'x', name: 'X' } }))
        .statusCode,
    ).toBe(403);
    expect((await fixture.call(user, { method: 'GET', url: '/api/projects/not-an-id' })).statusCode).toBe(400);
  });
});
