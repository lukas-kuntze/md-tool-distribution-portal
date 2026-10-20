import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Environment, Fetch } from './runner.js';
import { readConfig, resolveFiles, run } from './upload.js';

const APPLICATION_ID = '0192f3a4-0000-7000-8000-000000000002';
const RELEASE_ID = '0192f3a4-0000-7000-8000-0000000000d1';
const TOKEN_URL = 'https://pipelines.example/token?api-version=2.0';

interface Recorded {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

type Responder = (request: Recorded) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('upload action', (): void => {
  let workspace: string;
  let output: string;
  let lines: string[];
  let requests: Recorded[];

  beforeEach(async (): Promise<void> => {
    workspace = await mkdtemp(path.join(tmpdir(), 'mdtool-action-'));
    output = path.join(workspace, 'github-output');
    lines = [];
    requests = [];
    await mkdir(path.join(workspace, 'build', 'symbols.dSYM'), { recursive: true });
    await writeFile(path.join(workspace, 'build', 'app-production-release.apk'), 'android build');
    await writeFile(path.join(workspace, 'build', 'Runner.ipa'), 'ios build');
    await writeFile(path.join(workspace, 'build', 'Runner.dSYM.zip'), 'symbols');
    await writeFile(path.join(workspace, 'build', 'mapping.txt'), 'mapping');
    await writeFile(path.join(workspace, 'NOTES.md'), '  Neue Tourenplanung  \n');
  });

  afterEach(async (): Promise<void> => {
    await rm(workspace, { recursive: true, force: true });
  });

  function environment(inputs: Readonly<Record<string, string>>): Environment {
    return {
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: output,
      ACTIONS_ID_TOKEN_REQUEST_URL: TOKEN_URL,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-bearer',
      'INPUT_PORTAL-URL': 'https://apps.example.com/some/path',
      'INPUT_APPLICATION-ID': APPLICATION_ID,
      ...Object.fromEntries(Object.entries(inputs).map(([name, value]) => [`INPUT_${name.toUpperCase()}`, value])),
    };
  }

  function portal(respond: Responder): Fetch {
    let tokens = 0;

    return async (input, init = {}) => {
      const url = new URL(input);

      if (url.origin === 'https://pipelines.example') {
        tokens += 1;
        return json({ value: `oidc-token-${tokens}` });
      }

      const body = init.body === undefined || init.body === null ? '' : await new Response(init.body).text();
      const request: Recorded = {
        method: init.method ?? 'GET',
        url,
        headers: init.headers as Record<string, string>,
        body,
      };
      requests.push(request);
      return respond(request);
    };
  }

  const succeed: Responder = (request) =>
    request.method === 'PATCH'
      ? json({ applied: true })
      : json({
          releaseId: RELEASE_ID,
          artifactId: 'a',
          releaseCreated: request.url.searchParams.get('fileName') === 'app-production-release.apk',
        });

  it('uploads builds, supporting files and release notes and reports the release', async (): Promise<void> => {
    await run(
      environment({
        files: 'build/*.apk\nbuild/*.ipa',
        flavor: 'production',
        dsym: 'build/*.dSYM.zip',
        mapping: '# R8\nbuild/mapping.txt',
        'release-notes-file': 'NOTES.md',
      }),
      { fetch: portal(succeed), console: { write: (line) => lines.push(line) } },
    );

    expect(requests.map((request) => `${request.method} ${request.url.pathname}${request.url.search}`)).toEqual([
      `POST /api/ci/applications/${APPLICATION_ID}/builds?fileName=app-production-release.apk&flavor=production`,
      `POST /api/ci/applications/${APPLICATION_ID}/builds?fileName=Runner.ipa&flavor=production`,
      `POST /api/ci/releases/${RELEASE_ID}/artifacts?fileName=Runner.dSYM.zip&kind=dsym`,
      `POST /api/ci/releases/${RELEASE_ID}/artifacts?fileName=mapping.txt&kind=mapping`,
      `PATCH /api/ci/releases/${RELEASE_ID}/texts`,
    ]);
    expect(requests[0]).toMatchObject({
      body: 'android build',
      headers: {
        authorization: 'Bearer oidc-token-1',
        'content-type': 'application/octet-stream',
        'content-length': '13',
      },
    });
    // Every request gets a fresh token, and every token is masked in the log.
    expect(requests.map((request) => request.headers['authorization'])).toEqual(
      [1, 2, 3, 4, 5].map((token) => `Bearer oidc-token-${token}`),
    );
    expect(lines).toContain('::add-mask::oidc-token-1');
    expect(JSON.parse(requests[4]?.body ?? '')).toEqual({ releaseNotes: 'Neue Tourenplanung' });

    const outputs = await readFile(output, 'utf8');
    expect(outputs).toMatch(new RegExp(`release-id<<(ghadelimiter_[^\\n]+)\\n${RELEASE_ID}\\n\\1\\n`));
    expect(outputs).toContain(`https://apps.example.com/release.html?id=${RELEASE_ID}`);
  });

  it('asks for the OIDC permission and refuses unencrypted portals', async (): Promise<void> => {
    const missingPermission = { ...environment({ files: 'build/*.apk' }), ACTIONS_ID_TOKEN_REQUEST_URL: undefined };
    await expect(
      run(missingPermission, { fetch: portal(succeed), console: { write: () => undefined } }),
    ).rejects.toThrow(/id-token: write/);

    await expect(readConfig({ ...environment({}), 'INPUT_PORTAL-URL': 'http://apps.example.com' })).rejects.toThrow(
      /HTTPS/,
    );
    await expect(readConfig({ ...environment({}), 'INPUT_APPLICATION-ID': 'k-mobile' })).rejects.toThrow(
      /application-id/,
    );
    await expect(readConfig(environment({ 'release-notes': 'a', 'release-notes-file': 'NOTES.md' }))).rejects.toThrow(
      /either/,
    );
  });

  it('refuses missing files, directories and supporting files passed as builds', async (): Promise<void> => {
    await expect(resolveFiles(workspace, ['build/*.aab'])).rejects.toThrow('No file matches "build/*.aab"');
    await expect(resolveFiles(workspace, ['build/symbols.dSYM'])).rejects.toThrow(/ditto/);
    await expect(
      run(environment({ files: 'build/mapping.txt' }), { fetch: portal(succeed), console: { write: () => undefined } }),
    ).rejects.toThrow(/Only APK, AAB and IPA/);
    expect(requests).toEqual([]);
  });

  it('retries temporary failures and explains refused uploads', async (): Promise<void> => {
    let calls = 0;
    const flaky: Responder = (request) => {
      calls += 1;
      return calls === 1 ? new Response('busy', { status: 503 }) : succeed(request);
    };
    const waits: number[] = [];

    await run(environment({ files: 'build/*.apk' }), {
      fetch: portal(flaky),
      console: { write: (line) => lines.push(line) },
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
    });
    expect(calls).toBe(2);
    expect(waits).toEqual([2000]);
    expect(lines.some((line) => line.startsWith('::warning::The portal answered HTTP 503'))).toBe(true);

    const refused: Responder = () =>
      json({ error: { code: 'ci_binding_not_found', message: 'No CI binding matches this workflow' } }, 403);
    await expect(
      run(environment({ files: 'build/*.apk' }), { fetch: portal(refused), console: { write: () => undefined } }),
    ).rejects.toThrow(/ci_binding_not_found.*CI binding for this repository/);
  });

  it('refuses builds that end up in different releases', async (): Promise<void> => {
    let release = 0;
    const split: Responder = () => {
      release += 1;
      return json({ releaseId: `release-${release}`, artifactId: 'a', releaseCreated: true });
    };

    await expect(
      run(environment({ files: 'build/*.apk\nbuild/*.ipa' }), {
        fetch: portal(split),
        console: { write: () => undefined },
      }),
    ).rejects.toThrow(/different releases/);
  });
});
