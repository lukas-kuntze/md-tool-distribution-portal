import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
export class ActionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ActionError';
    }
}
/** Value of an input as GitHub passes it: `INPUT_<NAME>` with spaces as underscores, upper case, trimmed. */
export function input(environment, name, options = {}) {
    const value = (environment[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
    if (value === '' && options.required === true) {
        throw new ActionError(`Input "${name}" is required.`);
    }
    return value;
}
/** One entry per non-empty line; lines starting with `#` are comments. */
export function multilineInput(environment, name) {
    return input(environment, name)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'));
}
export async function setOutput(environment, name, value) {
    const file = environment['GITHUB_OUTPUT'];
    if (file === undefined || file === '') {
        return;
    }
    // The heredoc form is safe for any value; the delimiter is random so that a value cannot end it.
    const delimiter = `ghadelimiter_${randomUUID()}`;
    await appendFile(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
}
export function createLog(console) {
    return {
        info: (message) => console.write(message),
        warning: (message) => console.write(`::warning::${escapeCommand(message)}`),
        error: (message) => console.write(`::error::${escapeCommand(message)}`),
        mask: (secret) => console.write(`::add-mask::${secret}`),
    };
}
/**
 * Requests the OIDC token of the running job for the given audience. Available only when the workflow grants
 * `permissions: id-token: write`; the token expires after a few minutes, so it is requested per upload.
 */
export async function requestIdToken(environment, audience, fetch) {
    const url = environment['ACTIONS_ID_TOKEN_REQUEST_URL'];
    const bearer = environment['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
    if (url === undefined || url === '' || bearer === undefined || bearer === '') {
        throw new ActionError('No OIDC token available. Grant "permissions: id-token: write" to the job that runs this action.');
    }
    const request = new URL(url);
    request.searchParams.set('audience', audience);
    const response = await fetch(request.toString(), {
        headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
    });
    if (!response.ok) {
        throw new ActionError(`Requesting the OIDC token failed with HTTP ${response.status}.`);
    }
    const body = (await response.json());
    if (typeof body.value !== 'string' || body.value === '') {
        throw new ActionError('The OIDC token response contained no token.');
    }
    return body.value;
}
function escapeCommand(message) {
    return message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
