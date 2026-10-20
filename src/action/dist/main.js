// Entry point of the GitHub Action (see action.yml): runs the upload and reports failures to the workflow.
import { ActionError, createLog } from './runner.js';
import { run } from './upload.js';
const console = { write: (line) => void process.stdout.write(`${line}\n`) };
try {
    await run(process.env, { fetch: (input, init) => fetch(input, init), console });
}
catch (error) {
    createLog(console).error(error instanceof ActionError
        ? error.message
        : `Unexpected failure: ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
}
