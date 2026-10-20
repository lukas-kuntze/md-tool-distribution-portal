import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CiBindingDto, CiSettingsDto } from '../../../shared/types/api.js';
import { APPLICATION_ID } from '../testing/fixtures.js';
import { click, fakeApi, respond, submitForm, textOf, type } from '../testing/page.js';
import { ACTION_REFERENCE, bindingErrors, CiBindings, workflowSnippet } from './ci-bindings.js';
import { Overlays } from './overlays.js';

const BINDING_ID = '0192f3a4-0000-7000-8000-0000000000e1';

function binding(overrides: Partial<CiBindingDto> = {}): CiBindingDto {
  return {
    id: BINDING_ID,
    applicationId: APPLICATION_ID,
    repositoryId: 4711,
    repositoryName: 'medifox/pflege-mobil',
    refPattern: 'refs/heads/main',
    environment: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    createdBy: 'Lukas',
    revokedAt: null,
    ...overrides,
  };
}

function settings(bindings: readonly CiBindingDto[]): CiSettingsDto {
  return { bindings, portalUrl: 'https://apps.example.com', audience: 'https://apps.example.com' };
}

describe('CI bindings', (): void => {
  beforeAll((): void => {
    Overlays.init();
  });

  beforeEach((): void => {
    document.body.innerHTML = '<div id="panel"></div>';
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  const mount = (): void => CiBindings.mount(document.getElementById('panel') as HTMLElement, APPLICATION_ID);

  it('lists the bindings and the values for the workflow', async (): Promise<void> => {
    fakeApi({
      [`GET /api/applications/${APPLICATION_ID}/ci`]: settings([
        binding({ environment: 'production' }),
        binding({ id: 'old', repositoryName: 'medifox/alt', revokedAt: '2026-10-01T00:00:00.000Z' }),
      ]),
    });
    mount();

    await vi.waitFor(() => expect(textOf('#panel tbody')).toContain('medifox/pflege-mobil'));
    expect(textOf('#panel tbody')).toContain('production');
    expect(textOf('#panel tbody')).toContain('Getrennt');
    expect(document.querySelectorAll('#panel tbody button')).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('#ci-application-id')?.value).toBe(APPLICATION_ID);
    expect(textOf('#panel pre')).toContain('environment: production');
  });

  it('builds a workflow for branches, tags and environments', (): void => {
    const branch = workflowSnippet(APPLICATION_ID, settings([]), null);
    expect(branch).toContain("branches: ['main']");
    expect(branch).toContain(`uses: ${ACTION_REFERENCE}`);
    expect(branch).toContain(`application-id: ${APPLICATION_ID}`);
    expect(branch).not.toContain('environment:');
    expect(branch).not.toContain('audience:');

    const tags = workflowSnippet(
      APPLICATION_ID,
      { ...settings([]), audience: 'portal' },
      binding({ refPattern: 'refs/tags/v*', environment: 'production' }),
    );
    expect(tags).toContain("tags: ['v*']");
    expect(tags).toContain('environment: production');
    expect(tags).toContain('audience: portal');
  });

  it('checks the binding form before sending it', (): void => {
    expect(bindingErrors('medifox/pflege-mobil', '4711', 'refs/tags/v*')).toEqual({
      repositoryName: null,
      repositoryId: null,
      refPattern: null,
    });
    expect(Object.values(bindingErrors('pflege-mobil', 'abc', 'main'))).not.toContain(null);
  });

  it('connects and disconnects a repository', async (): Promise<void> => {
    let current: CiBindingDto[] = [];
    const calls = fakeApi({
      [`GET /api/applications/${APPLICATION_ID}/ci`]: () => settings(current),
      [`POST /api/applications/${APPLICATION_ID}/ci-bindings`]: () => {
        current = [binding({ environment: 'production' })];
        return respond(201, current[0]);
      },
      [`POST /api/ci-bindings/${BINDING_ID}/revoke`]: () => {
        current = [binding({ revokedAt: '2026-10-18T11:00:00.000Z' })];
        return respond(204);
      },
    });
    mount();

    await vi.waitFor(() => expect(textOf('#panel')).toContain('Kein Repository verbunden'));
    click(
      Array.from(document.querySelectorAll('#panel button')).find((button) =>
        button.textContent?.includes('Repository verbinden'),
      ) as Element,
    );
    type('#ci-repository', 'medifox/pflege-mobil');
    type('#ci-repository-id', '4711');
    type('#ci-environment', 'production');
    submitForm('#ci-bind form');

    await vi.waitFor(() => expect(textOf('#panel tbody')).toContain('medifox/pflege-mobil'));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      repositoryId: 4711,
      repositoryName: 'medifox/pflege-mobil',
      refPattern: 'refs/heads/main',
      environment: 'production',
    });

    click('#panel tbody button');
    click(
      Array.from(document.querySelectorAll('#ci-revoke button')).find((button) =>
        button.textContent?.includes('Trennen'),
      ) as Element,
    );

    await vi.waitFor(() => expect(textOf('#panel tbody')).toContain('Getrennt'));
  });
});
