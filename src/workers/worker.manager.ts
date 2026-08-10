import { closePostgresConnection } from '../database/postgres.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { closeRedisConnection } from '../redis/redis.js';
import { WORKER_DEFAULTS } from './worker.constants.js';
import { WorkerRegistry, workerRegistry as defaultWorkerRegistry } from './worker.registry.js';
import { WorkerRuntime } from './worker.runtime.js';
import { WorkerInfo, WorkerOptions } from './worker.types.js';
import { defaultJobProcessor } from './default.processor.js';
import { processorRegistry as defaultProcessorRegistry } from './processor.registry.js';

export class WorkerManager {
  public readonly runtime: WorkerRuntime;
  private readonly workerRegistry: WorkerRegistry;
  private readonly heartbeatIntervalMs: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isStarted = false;
  private workerInfo: WorkerInfo;

  constructor(options: WorkerOptions = {}, workerRegistry: WorkerRegistry = defaultWorkerRegistry) {
    this.workerRegistry = workerRegistry;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || WORKER_DEFAULTS.heartbeatIntervalMs;
    this.runtime = new WorkerRuntime(options);

    this.workerInfo = this.workerRegistry.buildWorkerInfo(
      this.runtime.workerId,
      this.runtime.queues,
      this.runtime.limiter.limit,
      'STARTING',
    );
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }
    this.isStarted = true;

    // Ensure default queue processor is registered out of the box
    if (!defaultProcessorRegistry.getProcessor('default')) {
      defaultProcessorRegistry.registerProcessor('default', defaultJobProcessor);
    }

    // 1. Register worker metadata in Redis
    await this.workerRegistry.registerWorker(this.workerInfo);

    // 2. Start Worker Runtime Loop
    void this.runtime.start();
    this.workerInfo.status = 'IDLE';
    await this.workerRegistry.registerWorker(this.workerInfo);

    // 3. Start Heartbeat Timer
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.heartbeatIntervalMs);

    appLogger.info('Worker Manager Started Successfully', {
      workerId: this.runtime.workerId,
      queues: this.runtime.queues,
      concurrency: this.runtime.limiter.limit,
    });
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    this.isStarted = false;

    appLogger.info('Worker Manager Shutdown Initiated...', { workerId: this.runtime.workerId });

    // 1. Stop Heartbeat Timer
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 2. Stop Worker Runtime Loop (flushes active in-flight jobs)
    await this.runtime.stop();

    // 3. Deregister Worker from Redis
    await this.workerRegistry.deregisterWorker(this.runtime.workerId);

    appLogger.info('Worker Manager Shutdown Completed Cleanly', {
      workerId: this.runtime.workerId,
    });
  }

  private async sendHeartbeat(): Promise<void> {
    const status = this.runtime.getStatus();
    const currentJobId = this.runtime.getCurrentJobId();
    const currentConcurrency = this.runtime.limiter.active;

    await this.workerRegistry.heartbeatWorker(
      this.runtime.workerId,
      status,
      currentJobId,
      currentConcurrency,
    );
  }

  setupGracefulShutdown(): void {
    const shutdownHandler = async (signal: string): Promise<void> => {
      appLogger.info(`Received ${signal}. Shutting down worker gracefully...`);
      try {
        await this.stop();
        await closeRedisConnection();
        await closePostgresConnection();
        appLogger.info('All resources released. Exiting process.');
        process.exit(0);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errorLogger.error('Error during graceful shutdown', { error: msg });
        process.exit(1);
      }
    };

    process.once('SIGINT', () => void shutdownHandler('SIGINT'));
    process.once('SIGTERM', () => void shutdownHandler('SIGTERM'));
  }
}

export const workerManager = new WorkerManager();
