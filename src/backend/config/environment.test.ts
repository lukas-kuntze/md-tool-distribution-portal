import { describe, expect, it } from 'vitest';

import { loadConfiguration } from './environment.js';

const valid = {
  PUBLIC_URL: 'https://apps.example.com/some/path',
  DATABASE_PATH: 'D:\\AppDistribution\\data\\distribution.db',
  STORAGE_ROOT: 'D:\\AppDistribution\\storage',
  SERVED_AREAS: 'D:\\AppDistribution\\app\\public; C:\\inetpub\\wwwroot',
  GITHUB_WEB_URL: 'https://github.example.com',
  GITHUB_API_URL: 'https://github.example.com/api/v3',
  GITHUB_CLIENT_ID: 'client',
  GITHUB_CLIENT_SECRET: 'secret',
  GITHUB_ORGANIZATION: 'md-ambulant',
  BOOTSTRAP_ADMIN_GITHUB_IDS: '1000, 2000',
  INSTALL_LINK_SECRET: 'a-signing-secret-of-at-least-32-characters',
};

describe('loadConfiguration', (): void => {
  it('applies defaults and converts units', (): void => {
    expect(loadConfiguration(valid)).toMatchObject({
      host: '127.0.0.1',
      port: 3000,
      publicUrl: 'https://apps.example.com',
      trustProxy: true,
      servedAreas: ['D:\\AppDistribution\\app\\public', 'C:\\inetpub\\wwwroot'],
      bootstrapAdminGitHubIds: new Set(['1000', '2000']),
      session: { absoluteMs: 12 * 60 * 60_000, idleMs: 120 * 60_000 },
      installLink: { secret: 'a-signing-secret-of-at-least-32-characters', lifetimeMs: 10 * 60_000 },
      quarantineRetentionMs: 7 * 24 * 60 * 60_000,
      worker: { pollMs: 30_000, leaseMs: 15 * 60_000, reconcileMs: 24 * 60 * 60_000 },
    });
  });

  it('signs in against github.com unless a GitHub Enterprise host is configured', (): void => {
    const { GITHUB_WEB_URL: _web, GITHUB_API_URL: _api, ...withoutGitHubUrls } = valid;

    expect(loadConfiguration(withoutGitHubUrls).gitHub).toMatchObject({
      webUrl: 'https://github.com',
      apiUrl: 'https://api.github.com',
    });
    expect(
      loadConfiguration({ ...withoutGitHubUrls, GITHUB_WEB_URL: 'https://github.example.com' }).gitHub,
    ).toMatchObject({
      webUrl: 'https://github.example.com',
      apiUrl: 'https://github.example.com/api/v3',
    });
    expect(loadConfiguration({ ...withoutGitHubUrls, GITHUB_WEB_URL: 'https://octo.ghe.com' }).gitHub.apiUrl).toBe(
      'https://api.octo.ghe.com',
    );
    expect(loadConfiguration({ ...valid, GITHUB_API_URL: 'https://api.example.com' }).gitHub.apiUrl).toBe(
      'https://api.example.com',
    );
  });

  it('derives issuer and audience of CI tokens unless configured', (): void => {
    const { GITHUB_WEB_URL: _web, GITHUB_API_URL: _api, ...withoutGitHubUrls } = valid;

    expect(loadConfiguration(withoutGitHubUrls).ci).toEqual({
      issuer: 'https://token.actions.githubusercontent.com',
      audience: 'https://apps.example.com',
    });
    expect(loadConfiguration({ ...withoutGitHubUrls, GITHUB_WEB_URL: 'https://github.example.com' }).ci.issuer).toBe(
      'https://github.example.com/_services/token',
    );
    expect(loadConfiguration({ ...withoutGitHubUrls, GITHUB_WEB_URL: 'https://octo.ghe.com' }).ci.issuer).toBe(
      'https://token.actions.octo.ghe.com',
    );
    expect(
      loadConfiguration({ ...valid, CI_OIDC_ISSUER: 'https://issuer.example.com', CI_OIDC_AUDIENCE: 'portal' }).ci,
    ).toEqual({ issuer: 'https://issuer.example.com', audience: 'portal' });
  });

  it('names invalid variables without revealing their values', (): void => {
    expect(() =>
      loadConfiguration({
        ...valid,
        GITHUB_CLIENT_SECRET: '',
        BOOTSTRAP_ADMIN_GITHUB_IDS: 'octocat',
        PORT: 'x',
        INSTALL_LINK_SECRET: 'short',
      }),
    ).toThrow('Invalid configuration: BOOTSTRAP_ADMIN_GITHUB_IDS, GITHUB_CLIENT_SECRET, INSTALL_LINK_SECRET, PORT');
  });
});
