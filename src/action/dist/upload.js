import { createReadStream } from 'node:fs';
import { glob, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { ActionError, createLog, input, multilineInput, requestIdToken, setOutput, } from './runner.js';
/** Supporting files uploaded into the release after the builds. */
export const SUPPORTING_KINDS = ['dsym', 'mapping', 'metadata'];
const BUILD_EXTENSIONS = ['.apk', '.aab', '.ipa'];
/** HTTP statuses after which an upload is repeated; the portal recognises a file it already stored. */
const RETRYABLE = new Set([408, 429, 502, 503, 504]);
const ATTEMPTS = 3;
/**
 * Uploads the builds of one workflow run into the distribution portal: every APK, AAB and IPA, then dSYM,
 * mapping and metadata files, then optional release notes. The portal authenticates the job by its OIDC token
 * and reads version, build number and flavor from the files; all builds of one call must end up in the same
 * release.
 */
export async function run(environment, dependencies) {
    const log = createLog(dependencies.console);
    const config = await readConfig(environment);
    const workspace = environment['GITHUB_WORKSPACE'] ?? process.cwd();
    const portal = new PortalClient(config, environment, dependencies);
    const builds = await resolveFiles(workspace, config.builds);
    const unknown = builds.filter((file) => !BUILD_EXTENSIONS.includes(path.extname(file.path).toLowerCase()));
    if (builds.length === 0) {
        throw new ActionError('Input "files" names no build. Pass at least one APK, AAB or IPA.');
    }
    if (unknown.length > 0) {
        throw new ActionError(`Only APK, AAB and IPA files are builds: ${unknown.map((file) => file.path).join(', ')}. Pass dSYM and mapping files through "dsym" and "mapping".`);
    }
    let releaseId = null;
    for (const file of builds) {
        const result = await portal.uploadBuild(file);
        log.info(`${result.releaseCreated ? 'Created release' : 'Added to release'} ${result.releaseId}: ${file.path}`);
        if (releaseId !== null && releaseId !== result.releaseId) {
            throw new ActionError('The builds belong to different releases. Builds of one call must share version and build number; upload each flavor in its own step.');
        }
        releaseId = result.releaseId;
    }
    if (releaseId === null) {
        throw new ActionError('No build was uploaded.');
    }
    for (const { kind, pattern } of config.supporting) {
        for (const file of await resolveFiles(workspace, [pattern])) {
            await portal.uploadSupporting(releaseId, kind, file);
            log.info(`Added ${kind} to release ${releaseId}: ${file.path}`);
        }
    }
    if (config.releaseNotes !== null || config.changelog !== null) {
        const applied = await portal.updateTexts(releaseId, config.releaseNotes, config.changelog);
        log.info(applied ? 'Release notes saved.' : 'Release notes kept: the release already has texts or is published.');
    }
    const releaseUrl = new URL(`/release.html?id=${encodeURIComponent(releaseId)}`, config.portal).toString();
    await setOutput(environment, 'release-id', releaseId);
    await setOutput(environment, 'release-url', releaseUrl);
    log.info(`Release: ${releaseUrl}`);
}
export async function readConfig(environment) {
    const portal = parsePortal(input(environment, 'portal-url', { required: true }));
    const applicationId = input(environment, 'application-id', { required: true });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(applicationId)) {
        throw new ActionError('Input "application-id" must be the id of the application, as shown in the portal.');
    }
    return {
        portal,
        applicationId,
        flavor: input(environment, 'flavor') || null,
        audience: input(environment, 'audience') || portal.origin,
        builds: multilineInput(environment, 'files'),
        supporting: SUPPORTING_KINDS.flatMap((kind) => multilineInput(environment, kind).map((pattern) => ({ kind, pattern }))),
        releaseNotes: await textInput(environment, 'release-notes'),
        changelog: await textInput(environment, 'changelog'),
    };
}
/** Expands paths and glob patterns relative to the workspace; a pattern that matches nothing is an error. */
export async function resolveFiles(workspace, patterns) {
    const files = [];
    for (const pattern of patterns) {
        const matches = [];
        for await (const match of glob(pattern, { cwd: workspace })) {
            matches.push(match);
        }
        if (matches.length === 0) {
            throw new ActionError(`No file matches "${pattern}".`);
        }
        for (const match of matches.sort()) {
            const absolute = path.resolve(workspace, match);
            const info = await stat(absolute);
            if (!info.isFile()) {
                throw new ActionError(`"${match}" is a directory. Zip dSYM bundles first, e.g. "ditto -c -k --keepParent <name>.dSYM <name>.dSYM.zip".`);
            }
            if (!files.some((file) => file.path === absolute)) {
                files.push({ path: absolute, sizeBytes: info.size });
            }
        }
    }
    return files;
}
class PortalClient {
    config;
    environment;
    dependencies;
    constructor(config, environment, dependencies) {
        this.config = config;
        this.environment = environment;
        this.dependencies = dependencies;
    }
    uploadBuild(file) {
        const query = new URLSearchParams({ fileName: path.basename(file.path) });
        if (this.config.flavor !== null) {
            query.set('flavor', this.config.flavor);
        }
        return this.sendFile(`/api/ci/applications/${encodeURIComponent(this.config.applicationId)}/builds?${query.toString()}`, file);
    }
    uploadSupporting(releaseId, kind, file) {
        const query = new URLSearchParams({ fileName: path.basename(file.path), kind });
        return this.sendFile(`/api/ci/releases/${encodeURIComponent(releaseId)}/artifacts?${query.toString()}`, file);
    }
    /** Returns whether the portal took the texts; it keeps texts that are already there. */
    async updateTexts(releaseId, releaseNotes, changelog) {
        const body = JSON.stringify({
            ...(releaseNotes === null ? {} : { releaseNotes }),
            ...(changelog === null ? {} : { changelog }),
        });
        const response = await this.send(`/api/ci/releases/${encodeURIComponent(releaseId)}/texts`, () => ({
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body,
        }));
        const result = (await response.json());
        return result.applied === true;
    }
    async sendFile(route, file) {
        const response = await this.send(route, () => {
            // A fresh stream per attempt; the body is streamed, never read into memory. Node's web stream type differs
            // from the DOM one in the type definitions only.
            const body = Readable.toWeb(createReadStream(file.path));
            return {
                method: 'POST',
                headers: { 'content-type': 'application/octet-stream', 'content-length': String(file.sizeBytes) },
                body: body,
                duplex: 'half',
            };
        });
        return (await response.json());
    }
    /** Sends with a fresh OIDC token and repeats on network errors and temporary server errors. */
    async send(route, request) {
        const { fetch } = this.dependencies;
        const sleep = this.dependencies.sleep ?? ((milliseconds) => delay(milliseconds).then(() => undefined));
        const log = createLog(this.dependencies.console);
        const url = new URL(route, this.config.portal).toString();
        for (let attempt = 1;; attempt += 1) {
            const token = await requestIdToken(this.environment, this.config.audience, fetch);
            log.mask(token);
            const init = request();
            let response;
            try {
                response = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
            }
            catch (error) {
                if (attempt >= ATTEMPTS) {
                    throw new ActionError(`The portal could not be reached: ${error instanceof Error ? error.message : 'unknown error'}.`);
                }
                log.warning(`The portal could not be reached, attempt ${attempt} of ${ATTEMPTS}; retrying.`);
                await sleep(attempt * 2000);
                continue;
            }
            if (response.ok) {
                return response;
            }
            if (RETRYABLE.has(response.status) && attempt < ATTEMPTS) {
                log.warning(`The portal answered HTTP ${response.status}, attempt ${attempt} of ${ATTEMPTS}; retrying.`);
                await sleep(attempt * 2000);
                continue;
            }
            throw await errorOf(response);
        }
    }
}
async function errorOf(response) {
    let code = `http_${response.status}`;
    let message = response.statusText;
    try {
        const body = (await response.json());
        code = typeof body.error?.code === 'string' ? body.error.code : code;
        message = typeof body.error?.message === 'string' ? body.error.message : message;
    }
    catch {
        // Not a JSON error body, e.g. from a proxy in front of the portal.
    }
    const hint = response.status === 401 || response.status === 403
        ? ' Check that the application has a CI binding for this repository, branch or tag and environment.'
        : '';
    return new ActionError(`The portal refused the upload (${code}): ${message}.${hint}`);
}
function parsePortal(value) {
    let portal;
    try {
        portal = new URL(value);
    }
    catch {
        throw new ActionError('Input "portal-url" must be an absolute URL, e.g. https://apps.example.com.');
    }
    if (portal.protocol !== 'https:' && portal.hostname !== 'localhost' && portal.hostname !== '127.0.0.1') {
        throw new ActionError('Input "portal-url" must use HTTPS; the OIDC token must not travel unencrypted.');
    }
    return new URL(portal.origin);
}
/** Text from `<name>` or from the file named by `<name>-file`; `null` when neither is set. */
async function textInput(environment, name) {
    const text = input(environment, name);
    const file = input(environment, `${name}-file`);
    if (text !== '' && file !== '') {
        throw new ActionError(`Pass either "${name}" or "${name}-file", not both.`);
    }
    if (file !== '') {
        return (await readFile(path.resolve(environment['GITHUB_WORKSPACE'] ?? process.cwd(), file), 'utf8')).trim();
    }
    return text === '' ? null : text;
}
