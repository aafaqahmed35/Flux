import { validateEnvConfig } from '../config/config.schema.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { openTelemetryManager } from '../observability/opentelemetry.js';
import { workerManager } from '../workers/worker.manager.js';
import { setupSignalHandlers } from './shutdown.js';

async function bootstrapWorker(): Promise<void> {
  validateEnvConfig();

  appLogger.info('Starting Flux Worker Process (Job Execution & Polling Only)...');

  await openTelemetryManager.start();

  await workerManager.start();
  appLogger.info('Worker Manager initialized and listening for jobs...');

  setupSignalHandlers('WORKER');
}

void bootstrapWorker().catch((err: unknown) => {
  errorLogger.error('Failed to bootstrap Flux Worker process', { error: String(err) });
  process.exit(1);
});
