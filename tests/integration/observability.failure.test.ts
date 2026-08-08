import request from 'supertest';
import app from '../../src/app.js';
import { closePostgresConnection, pgPool } from '../../src/database/postgres.js';
import { closeRedisConnection } from '../../src/redis/redis.js';
import { processorRegistry } from '../../src/workers/processor.registry.js';
import { WorkerRuntime } from '../../src/workers/worker.runtime.js';
import { openTelemetryManager } from '../../src/observability/opentelemetry.js';

describe('Telemetry Failure Isolation Integration Tests', () => {
  const queueName = 'obs-failure-queue';
  let worker: WorkerRuntime;

  beforeAll(async () => {
    // Simulate telemetry SDK shutdown/failure
    await openTelemetryManager.shutdown();

    processorRegistry.registerProcessor(queueName, {
      execute: () => Promise.resolve({ ok: true }),
    });

    worker = new WorkerRuntime({
      workerId: 'obs-fail-worker',
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

  it('should process job to completion even when tracing exporter is unavailable or disabled', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({
        name: 'fail-isolation-job',
        queueName,
        payload: { test: true },
      });

    expect(res.status).toBe(201);
    const responseBody = res.body as { data: { id: string } };
    const jobId = responseBody.data.id;

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
  });
});
