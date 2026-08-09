import app from '../app.js';
import { validateEnvConfig } from '../config/config.schema.js';
import { serverConfig } from '../config/server.js';
import { runMigrations } from '../database/migrator.js';
import { bootstrapDevUser } from '../auth/dev.bootstrap.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { openTelemetryManager } from '../observability/opentelemetry.js';
import { setupSignalHandlers } from './shutdown.js';

async function bootstrapApi(): Promise<void> {
  validateEnvConfig();

  appLogger.info('Starting Flux API Process (HTTP / REST Only)...');

  await runMigrations();
  await bootstrapDevUser();

  await openTelemetryManager.start();

  const server = app.listen(serverConfig.port, () => {
    appLogger.info(
      `Flux API listening at http://localhost:${serverConfig.port} [${serverConfig.env}]`,
    );
  });

  setupSignalHandlers('API', server);
}

void bootstrapApi().catch((err: unknown) => {
  errorLogger.error('Failed to bootstrap Flux API process', { error: String(err) });
  process.exit(1);
});
