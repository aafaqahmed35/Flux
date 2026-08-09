/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, no-console */
import { pgPool } from '../../src/database/postgres.js';
import { runMigrations } from '../../src/database/migrator.js';
import { redisClient } from '../../src/redis/redis.js';
import { JobService } from '../../src/services/job.service.js';
import { PostgresJobRepository } from '../../src/repositories/job.repository.js';
import { RedisQueue } from '../../src/queue/redis.queue.js';
import { QueueService } from '../../src/queue/queue.service.js';
import { WorkerRuntime } from '../../src/workers/worker.runtime.js';
import { processorRegistry } from '../../src/workers/processor.registry.js';
import { JobStatus } from '../../src/constants/job.constants.js';

export interface PerformanceMetrics {
  totalJobs: number;
  concurrency: number;
  queueName: string;
  creationTimeMs: number;
  creationThroughputJobsPerSec: number;
  processingTimeMs: number;
  processingThroughputJobsPerSec: number;
  totalDurationMs: number;
  totalThroughputJobsPerSec: number;
  latenciesMs: {
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    avg: number;
  };
  completedCount: number;
  failedCount: number;
  dlqCount: number;
  lostJobsCount: number;
  duplicateCount: number;
  errorRate: number;
}

export async function runLoadTest(options?: {
  totalJobs?: number;
  concurrency?: number;
  queueName?: string;
  workerDelayMs?: number;
}): Promise<PerformanceMetrics> {
  const totalJobs = options?.totalJobs ?? parseInt(process.env.LOAD_JOBS || '1000', 10);
  const concurrency = options?.concurrency ?? parseInt(process.env.LOAD_CONCURRENCY || '25', 10);
  const queueName = options?.queueName ?? (process.env.LOAD_QUEUE || `load-queue-${Date.now()}`);
  const workerDelayMs = options?.workerDelayMs ?? 5;

  const repository = new PostgresJobRepository(pgPool);
  const queueEngine = new RedisQueue(redisClient);
  const queueService = new QueueService(queueEngine, repository);
  const jobService = new JobService(repository, queueService);

  // Register processor
  const processedJobIds = new Set<string>();
  let duplicateExecutionCount = 0;

  processorRegistry.registerProcessor(queueName, async (job) => {
    if (processedJobIds.has(job.id)) {
      duplicateExecutionCount++;
    }
    processedJobIds.add(job.id);
    if (workerDelayMs > 0) {
      await new Promise((r) => setTimeout(r, workerDelayMs));
    }
    return { processedAt: new Date().toISOString() };
  });

  const worker = new WorkerRuntime(
    {
      workerId: `load-worker-${Date.now()}`,
      queues: [queueName],
      concurrency,
      pollIntervalMs: 10,
    },
    queueEngine,
    repository,
  );

  const startCreationTime = Date.now();
  const createdJobIds: string[] = [];

  // Batch job creation
  const batchSize = 100;
  for (let i = 0; i < totalJobs; i += batchSize) {
    const batchPromises: Promise<any>[] = [];
    const currentBatchSize = Math.min(batchSize, totalJobs - i);
    for (let j = 0; j < currentBatchSize; j++) {
      batchPromises.push(
        jobService.createJob({
          name: `load-job-${i + j}`,
          queueName,
          payload: { index: i + j },
        }),
      );
    }
    const results = await Promise.all(batchPromises);
    results.forEach((res) => createdJobIds.push(res.job.id));
  }

  const creationTimeMs = Date.now() - startCreationTime;
  const creationThroughputJobsPerSec = Number((totalJobs / (creationTimeMs / 1000)).toFixed(2));

  // Start worker processing
  const startProcessingTime = Date.now();
  await worker.start();

  // Poll for completion until all created jobs have reached terminal state or timeout
  const timeoutMs = Math.max(30000, totalJobs * 50);
  const pollIntervalMs = 50;
  let elapsed = 0;

  let completedCount = 0;
  let failedCount = 0;
  let dlqCount = 0;

  while (elapsed < timeoutMs) {
    const countsRes = await pgPool.query(
      `SELECT status, COUNT(*)::int as count 
       FROM jobs 
       WHERE queue_name = $1 AND is_deleted = FALSE 
       GROUP BY status`,
      [queueName],
    );

    const counts: Record<string, number> = {};
    countsRes.rows.forEach((row) => {
      counts[row.status] = row.count;
    });

    completedCount = counts[JobStatus.COMPLETED] || 0;
    failedCount = counts[JobStatus.FAILED] || 0;
    dlqCount = counts[JobStatus.DEAD_LETTER] || 0;

    const terminalCount = completedCount + failedCount + dlqCount;
    if (terminalCount >= totalJobs) {
      break;
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
    elapsed += pollIntervalMs;
  }

  const processingTimeMs = Date.now() - startProcessingTime;
  await worker.stop();

  const totalDurationMs = Date.now() - startCreationTime;
  const processingThroughputJobsPerSec = Number(
    ((completedCount + failedCount + dlqCount) / (processingTimeMs / 1000)).toFixed(2),
  );
  const totalThroughputJobsPerSec = Number((totalJobs / (totalDurationMs / 1000)).toFixed(2));

  // Retrieve execution time latencies from DB
  const latencyRes = await pgPool.query(
    `SELECT execution_time_ms 
     FROM jobs 
     WHERE queue_name = $1 AND execution_time_ms IS NOT NULL 
     ORDER BY execution_time_ms ASC`,
    [queueName],
  );

  const latencies = latencyRes.rows.map((r) => r.execution_time_ms as number);
  let p50 = 0;
  let p95 = 0;
  let p99 = 0;
  let min = 0;
  let max = 0;
  let avg = 0;

  if (latencies.length > 0) {
    min = latencies[0];
    max = latencies[latencies.length - 1];
    avg = Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2));
    p50 = latencies[Math.floor(latencies.length * 0.5)];
    p95 = latencies[Math.floor(latencies.length * 0.95)];
    p99 = latencies[Math.floor(latencies.length * 0.99)];
  }

  const lostJobsCount = totalJobs - (completedCount + failedCount + dlqCount);
  const errorRate = Number(((failedCount + dlqCount + lostJobsCount) / totalJobs).toFixed(4));

  // Cleanup queue & processor
  processorRegistry.removeProcessor(queueName);
  await queueEngine.clear(queueName).catch(() => {});
  await pgPool.query('DELETE FROM jobs WHERE queue_name = $1', [queueName]);

  return {
    totalJobs,
    concurrency,
    queueName,
    creationTimeMs,
    creationThroughputJobsPerSec,
    processingTimeMs,
    processingThroughputJobsPerSec,
    totalDurationMs,
    totalThroughputJobsPerSec,
    latenciesMs: { p50, p95, p99, min, max, avg },
    completedCount,
    failedCount,
    dlqCount,
    lostJobsCount,
    duplicateCount: duplicateExecutionCount,
    errorRate,
  };
}

// Runnable CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  void (async (): Promise<void> => {
    try {
      await runMigrations();
      console.log('🚀 Running Flux Performance Load Test...');
      const metrics = await runLoadTest();
      console.log('\n--- Flux Benchmark Metrics ---');
      console.log(JSON.stringify(metrics, null, 2));
      await pgPool.end();
      if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
        await redisClient.quit();
      }
      process.exit(0);
    } catch (err) {
      console.error('Benchmark failed:', err);
      process.exit(1);
    }
  })();
}
