import { appLogger, errorLogger } from '../logger/logger.js';
import { ProcessorNotFoundError } from '../workers/worker.errors.js';
import {
  ProcessorRegistry,
  processorRegistry as defaultProcessorRegistry,
} from '../workers/processor.registry.js';
import { Job } from '../types/job.types.js';
import { ExecutionContext } from './execution.context.js';
import { ExecutionResult } from './execution.result.js';
import { IExecutionEngine } from './execution.interface.js';

export class ExecutionEngine implements IExecutionEngine {
  private readonly processorRegistry: ProcessorRegistry;

  constructor(processorRegistry: ProcessorRegistry = defaultProcessorRegistry) {
    this.processorRegistry = processorRegistry;
  }

  async execute(job: Job, context: ExecutionContext): Promise<ExecutionResult> {
    const processor = this.processorRegistry.getProcessor(job.queueName);
    if (!processor) {
      const err = new ProcessorNotFoundError(job.queueName);
      errorLogger.error('Processor not registered for queue', {
        queueName: job.queueName,
        jobId: job.id,
      });
      return {
        success: false,
        durationMs: 0,
        error: err,
      };
    }

    const start = Date.now();
    appLogger.info('Job Execution Started', {
      jobId: job.id,
      name: job.name,
      queueName: job.queueName,
    });

    try {
      const output = await processor.execute(job, context);
      const durationMs = Date.now() - start;
      appLogger.info('Job Execution Completed', {
        jobId: job.id,
        name: job.name,
        queueName: job.queueName,
        durationMs,
      });

      return {
        success: true,
        durationMs,
        result: output,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const errorObj = err instanceof Error ? err : new Error(String(err));
      errorLogger.error('Job Execution Failed', {
        jobId: job.id,
        name: job.name,
        queueName: job.queueName,
        durationMs,
        error: errorObj.message,
      });

      return {
        success: false,
        durationMs,
        error: errorObj,
      };
    }
  }
}

export const executionEngine = new ExecutionEngine();
