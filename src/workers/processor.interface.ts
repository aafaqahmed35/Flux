import { ExecutionContext } from '../execution/execution.context.js';
import { Job } from '../types/job.types.js';

export interface JobProcessor {
  execute(job: Job, context: ExecutionContext): Promise<unknown>;
}
