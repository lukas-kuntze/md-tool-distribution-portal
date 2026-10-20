import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createInfrastructure,
  createWebServer,
  platformSettings,
  startDeletionWorker,
  startValues,
} from './composition-root.js';
import { loadConfiguration, type Configuration } from './environment.js';

describe('composition root', (): void => {
  let base: string;
  let configuration: Configuration;

  beforeEach(async (): Promise<void> => {
    base = await mkdtemp(path.join(tmpdir(), 'composition-'));
    await mkdir(path.join(base, 'storage'));
    configuration = loadConfiguration({
      PUBLIC_URL: 'https://apps.example.com',
      DATABASE_PATH: path.join(base, 'distribution.db'),
      STORAGE_ROOT: path.join(base, 'storage'),
      SERVED_AREAS: path.join(base, 'wwwroot'),
      GITHUB_WEB_URL: 'https://github.example.com',
      GITHUB_API_URL: 'https://github.example.com/api/v3',
      GITHUB_CLIENT_ID: 'client',
      GITHUB_CLIENT_SECRET: 'secret',
      GITHUB_ORGANIZATION: 'md-ambulant',
      INSTALL_LINK_SECRET: 'a-signing-secret-of-at-least-32-characters',
      WORKER_POLL_SECONDS: '0.01',
    });
  });

  afterEach(async (): Promise<void> => {
    await rm(base, { recursive: true, force: true });
  });

  it('migrates the database, wires the web server and runs the worker until stopped', async (): Promise<void> => {
    const infrastructure = await createInfrastructure(configuration);
    const server = createWebServer(configuration, infrastructure);
    const stop = new AbortController();

    const login = await server.inject({ method: 'GET', url: '/auth/github/login' });
    const worker = startDeletionWorker(configuration, infrastructure, stop.signal);

    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toMatch(/^https:\/\/github\.example\.com\/login\/oauth\/authorize\?/);
    expect(infrastructure.database.prepare('SELECT max(version) AS version FROM schema_migrations').get()).toEqual({
      version: 10,
    });

    stop.abort();
    await worker;
    await server.close();
    infrastructure.database.close();
  });

  it('refuses a storage root inside a served area', async (): Promise<void> => {
    await expect(createInfrastructure({ ...configuration, servedAreas: [base] })).rejects.toThrow(
      expect.objectContaining({ code: 'root_in_served_area' }),
    );
  });

  it('describes the platform settings without any secret', (): void => {
    const settings = platformSettings(configuration);

    expect(settings).toMatchObject({
      version: expect.stringMatching(/^\d+\.\d+\.\d+/) as unknown,
      publicUrl: 'https://apps.example.com',
      gitHub: { organization: 'md-ambulant' },
      ci: { issuer: 'https://github.example.com/_services/token', audience: 'https://apps.example.com' },
    });
    expect(JSON.stringify(settings)).not.toContain('secret');
  });

  it('seeds the settings from the environment once and keeps them afterwards', async (): Promise<void> => {
    const seeded = startValues({ ...configuration, quarantineRetentionMs: 14 * 24 * 60 * 60_000 });
    expect(seeded).toMatchObject({
      quarantineDays: 14,
      sessionAbsoluteHours: 12,
      installLinkMinutes: 10,
      reconcileHours: 24,
    });
    // Values outside the accepted range are clamped instead of stopping the start.
    expect(startValues({ ...configuration, quarantineRetentionMs: 1000 * 24 * 60 * 60_000 }).quarantineDays).toBe(90);

    const first = await createInfrastructure({ ...configuration, quarantineRetentionMs: 14 * 24 * 60 * 60_000 });
    first.database.close();
    const second = await createInfrastructure({ ...configuration, quarantineRetentionMs: 3 * 24 * 60 * 60_000 });
    expect(second.unitOfWork.read(({ settings }) => settings.load()?.value.quarantineDays)).toBe(14);
    second.database.close();
  });
});
