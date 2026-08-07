import { Job } from '../types/job.types.js';
import { ExecutionContext } from './execution.context.js';
import { ExecutionResult } from './execution.result.js';

export interface IExecutionEngine {
  execute(job: Job, context: ExecutionContext): Promise<ExecutionResult>;
}
