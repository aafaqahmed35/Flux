import { ExecutionContext } from '../execution/execution.context.js';
import { Job } from '../types/job.types.js';

export interface JobProcessorObject {
  execute(job: Job, context: ExecutionContext): Promise<unknown>;
}

export type JobProcessorFn = (job: Job, context: ExecutionContext) => Promise<unknown>;

export type JobProcessor = JobProcessorObject | JobProcessorFn;
