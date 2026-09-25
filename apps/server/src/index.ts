import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app, ctx } = await buildApp(config, { logger: true });

const timer = setInterval(() => {
  try {
    ctx.services.runJobs();
  } catch (err) {
    app.log.error(err, 'Error en tareas periódicas');
  }
}, config.jobIntervalMs);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
