import { createInfrastructure, startDeletionWorker } from './backend/config/composition-root.js';
import { loadConfiguration } from './backend/config/environment.js';

const configuration = loadConfiguration();
const infrastructure = await createInfrastructure(configuration);
const stop = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => stop.abort());
}

await startDeletionWorker(configuration, infrastructure, stop.signal);
infrastructure.database.close();
