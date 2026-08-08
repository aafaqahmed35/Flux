export type MetricLabels = Record<string, string | number | undefined>;

export interface JobMetricLabels {
  queue?: string;
  priority?: string;
  status?: string;
  strategy?: string;
  failure_type?: string;
  [key: string]: string | number | undefined;
}

export interface QueueMetricLabels {
  queue?: string;
  [key: string]: string | number | undefined;
}

export interface WorkerMetricLabels {
  workerId?: string;
  queue?: string;
  [key: string]: string | number | undefined;
}

export interface TraceContext {
  traceId?: string;
  spanId?: string;
  correlationId?: string;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  isSampled: boolean;
}

export interface JobExecutionTelemetry {
  jobId: string;
  name: string;
  queueName: string;
  attempt: number;
  durationMs: number;
  queueWaitMs?: number;
  status: string;
  error?: string;
}

export interface QueueTelemetry {
  queueName: string;
  depth: number;
  processing: number;
  delayed?: number;
}

export interface WorkerTelemetry {
  workerId: string;
  active: boolean;
  busy: boolean;
  currentQueue?: string;
}
