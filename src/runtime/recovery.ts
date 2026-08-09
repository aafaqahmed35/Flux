import { validateEnvConfig } from '../config/config.schema.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { openTelemetryManager } from '../observability/opentelemetry.js';
import { recoveryRuntime } from '../recovery/recovery.runtime.js';
import { setupSignalHandlers } from './shutdown.js';

async function bootstrapRecovery(): Promise<void> {
  validateEnvConfig();

  appLogger.info(
    'Starting Flux Recovery Process (Distributed Fault Tolerance & Reconciliation)...',
  );

  await openTelemetryManager.start();

  await recoveryRuntime.start();
  appLogger.info('Recovery Runtime started with leader election polling...');

  setupSignalHandlers('RECOVERY');
}

void bootstrapRecovery().catch((err: unknown) => {
  errorLogger.error('Failed to bootstrap Flux Recovery process', { error: String(err) });
  process.exit(1);
});
