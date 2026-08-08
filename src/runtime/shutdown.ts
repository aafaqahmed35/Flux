import { Server } from 'node:http';
import { appLogger, errorLogger } from '../logger/logger.js';
import { openTelemetryManager } from '../observability/opentelemetry.js';
import { pgPool } from '../database/postgres.js';
import { redisClient } from '../redis/redis.js';
import { workerManager } from '../workers/worker.manager.js';
import { schedulerRuntime } from '../schedules/scheduler.runtime.js';

let isShuttingDown = false;

export async function gracefulShutdown(
  processType: 'API' | 'WORKER' | 'SCHEDULER',
  httpServer?: Server,
): Promise<void> {
  if (isShuttingDown) {
    appLogger.warn('Shutdown already in progress, ignoring duplicate signal', { processType });
    return;
  }
  isShuttingDown = true;
  appLogger.info(`Initiating graceful shutdown for Flux ${processType}...`);

  const shutdownTimeout = setTimeout(() => {
    errorLogger.error(`Graceful shutdown timed out for ${processType}, forcing exit`);
    process.exit(1);
  }, 15000);

  try {
    if (processType === 'API' && httpServer) {
      appLogger.info('Closing HTTP server to stop accepting new requests...');
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          appLogger.info('HTTP server closed cleanly');
          resolve();
        });
      });
    }

    if (processType === 'WORKER') {
      appLogger.info('Stopping worker manager and active worker runtime...');
      await workerManager.stop();
      appLogger.info('Worker manager stopped cleanly');
    }

    if (processType === 'SCHEDULER') {
      appLogger.info('Stopping scheduler runtime and releasing leadership...');
      await schedulerRuntime.stop();
      appLogger.info('Scheduler runtime stopped cleanly');
    }

    appLogger.info('Shutting down OpenTelemetry SDK...');
    await openTelemetryManager.shutdown();

    if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
      appLogger.info('Disconnecting Redis client...');
      await redisClient.quit();
      appLogger.info('Redis client disconnected cleanly');
    }

    appLogger.info('Closing PostgreSQL pool...');
    await pgPool.end();
    appLogger.info('PostgreSQL pool closed cleanly');

    clearTimeout(shutdownTimeout);
    appLogger.info(`Flux ${processType} process exited cleanly`);
    process.exit(0);
  } catch (err: unknown) {
    errorLogger.error(`Error during ${processType} graceful shutdown`, { error: String(err) });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

export function setupSignalHandlers(
  processType: 'API' | 'WORKER' | 'SCHEDULER',
  httpServer?: Server,
): void {
  const handler = (signal: string): void => {
    appLogger.info(`Received signal ${signal}`);
    void gracefulShutdown(processType, httpServer);
  };

  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}
