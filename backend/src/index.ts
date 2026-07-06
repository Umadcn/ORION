/**
 * Project ORION backend entrypoint.
 * Express app bound to loopback (127.0.0.1) only — never exposed to the LAN.
 */
import { config } from './config.js';
import { buildApp } from './app.js';

const app = buildApp();

const server = app.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`[ORION] Backend listening on http://${config.host}:${config.port} (mode=${config.integrationMode})`);
  if (config.usingDefaultJwtSecret) {
    console.log('[ORION] WARNING: using the built-in dev JWT secret. Set ORION_JWT_SECRET for production.');
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}

export { app };
