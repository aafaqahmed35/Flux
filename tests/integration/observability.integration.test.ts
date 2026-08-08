import request from 'supertest';
import app from '../../src/app.js';
import { closePostgresConnection, pgPool } from '../../src/database/postgres.js';
import { closeRedisConnection } from '../../src/redis/redis.js';
import { processorRegistry } from '../../src/workers/processor.registry.js';
import { WorkerRuntime } from '../../src/workers/worker.runtime.js';
import { prometheusRegistry } from '../../src/observability/prometheus.js';

describe('Observability Full Lifecycle Integration Test', () => {
  const queueName = 'obs-e2e-queue';
  let worker: WorkerRuntime;

  beforeAll(async () => {
    processorRegistry.registerProcessor(queueName, {
      execute: () => Promise.resolve({ success: true }),
    });

    worker = new WorkerRuntime({
      workerId: 'obs-test-worker',
      queues: [queueName],
      pollIntervalMs: 50,
    });
    await worker.start();
  });

  afterAll(async () => {
    await worker.stop();
    processorRegistry.removeProcessor(queueName);
    await closePostgresConnection();
    await closeRedisConnection();
  });

  it('should instrument job creation, execution, and completion metrics end-to-end', async () => {
    // 1. Submit job via API
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({
        name: 'obs-lifecycle-job',
        queueName,
        payload: { test: true },
      });

    expect(res.status).toBe(201);
    const responseBody = res.body as { data: { id: string } };
    const jobId = responseBody.data.id;

    // 2. Poll PostgreSQL until COMPLETED
    let status = 'QUEUED';
    let attempts = 0;
    while (status !== 'COMPLETED' && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const check = await pgPool.query<{ status: string }>(
        'SELECT status FROM jobs WHERE id = $1',
        [jobId],
      );
      status = check.rows[0]?.status || 'UNKNOWN';
      attempts++;
    }

    expect(status).toBe('COMPLETED');

    // 3. Inspect Prometheus metrics
    const metricsText = await prometheusRegistry.getMetricsText();
    expect(metricsText).toContain('flux_jobs_created_total');
    expect(metricsText).toContain('flux_jobs_completed_total');
    expect(metricsText).toContain('flux_worker_job_duration_ms');
  });
});
