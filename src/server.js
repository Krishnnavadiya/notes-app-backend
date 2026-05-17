'use strict';

const { createApp } = require('./app');
const { initSchema } = require('./db/schema');
const { getDb } = require('./db');
const config = require('./config');

async function main() {
  await initSchema();
  const app = createApp();

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[server] Notes API listening on http://localhost:${config.port}\n` +
        `  Docs:    http://localhost:${config.port}/docs\n` +
        `  OpenAPI: http://localhost:${config.port}/openapi.json\n` +
        `  UI:      http://localhost:${config.port}/ui`
    );
  });

  function shutdown(signal) {
    // eslint-disable-next-line no-console
    console.log(`[server] Received ${signal}, shutting down...`);
    server.close(async () => {
      try {
        await getDb().close();
      } catch (_) {
        /* ignore */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
