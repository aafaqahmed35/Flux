import { ExecutionContext } from '../execution/execution.context.js';
import { appLogger } from '../logger/logger.js';
import { Job } from '../types/job.types.js';
import { JobProcessorObject } from './processor.interface.js';

export class DefaultJobProcessor implements JobProcessorObject {
  execute(job: Job, context: ExecutionContext): Promise<unknown> {
    const payload = job.payload as Record<string, unknown> | undefined;

    if (payload && (payload.shouldFail === true || payload.fail === true)) {
      const errorMsg =
        typeof payload.errorMessage === 'string'
          ? payload.errorMessage
          : 'Simulated job execution failure';
      appLogger.warn('Default Job Processor throwing failure for test payload', {
        jobId: job.id,
        name: job.name,
        attempt: context.attempt,
        error: errorMsg,
      });
      return Promise.reject(new Error(errorMsg));
    }

    appLogger.info('Default Job Processor executing job payload', {
      jobId: job.id,
      name: job.name,
      queueName: job.queueName,
      workerId: context.workerId,
      attempt: context.attempt,
      payload: job.payload,
    });

    return Promise.resolve({
      status: 'PROCESSED',
      jobId: job.id,
      name: job.name,
      executedAt: new Date().toISOString(),
      workerId: context.workerId,
    });
  }
}

export const defaultJobProcessor = new DefaultJobProcessor();
