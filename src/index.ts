import { createInfrastructure, createWebServer } from './backend/config/composition-root.js';
import { loadConfiguration } from './backend/config/environment.js';

const configuration = loadConfiguration();
const infrastructure = await createInfrastructure(configuration);
const server = createWebServer(configuration, infrastructure);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().finally(() => infrastructure.database.close());
  });
}

await server.listen({ host: configuration.host, port: configuration.port });
