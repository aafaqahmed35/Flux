import { Logger } from 'winston';

export interface ExecutionContext {
  jobId: string;
  jobName: string;
  traceId: string;
  correlationId: string;
  workerId: string;
  queueName: string;
  attempt: number;
  startedAt: Date;
  logger: Logger;
}
