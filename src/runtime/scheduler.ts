import { validateEnvConfig } from '../config/config.schema.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { openTelemetryManager } from '../observability/opentelemetry.js';
import { schedulerRuntime } from '../schedules/scheduler.runtime.js';
import { setupSignalHandlers } from './shutdown.js';

async function bootstrapScheduler(): Promise<void> {
  validateEnvConfig();

  appLogger.info('Starting Flux Scheduler Process (Cron Engine & Leader Election Only)...');

  await openTelemetryManager.start();

  await schedulerRuntime.start();
  appLogger.info('Scheduler Runtime started with leader lock acquisition polling...');

  setupSignalHandlers('SCHEDULER');
}

void bootstrapScheduler().catch((err: unknown) => {
  errorLogger.error('Failed to bootstrap Flux Scheduler process', { error: String(err) });
  process.exit(1);
});
