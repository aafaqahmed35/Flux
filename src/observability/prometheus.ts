import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import {
  METRIC_NAMES,
  DEFAULT_LATENCY_BUCKETS_MS,
  API_LATENCY_BUCKETS_MS,
  DB_LATENCY_BUCKETS_MS,
  REDIS_LATENCY_BUCKETS_MS,
} from './observability.constants.js';
import { appLogger, errorLogger } from '../logger/logger.js';

export class PrometheusRegistry {
  private readonly registry: Registry;
  private readonly counters = new Map<string, Counter<string>>();
  private readonly gauges = new Map<string, Gauge<string>>();
  private readonly histograms = new Map<string, Histogram<string>>();
  private enabled: boolean = true;

  constructor(options?: { collectDefaultMetrics?: boolean; enabled?: boolean }) {
    this.registry = new Registry();
    this.enabled = options?.enabled ?? true;

    if (this.enabled && options?.collectDefaultMetrics !== false) {
      try {
        collectDefaultMetrics({ register: this.registry, prefix: 'flux_process_' });
      } catch (err) {
        errorLogger.error('Failed to collect default process metrics', { error: String(err) });
      }
    }

    this.registerCoreMetrics();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private registerCoreMetrics(): void {
    try {
      // Job Counters
      this.getOrCreateCounter(METRIC_NAMES.JOBS_CREATED_TOTAL, 'Total jobs created', [
        'queue',
        'priority',
      ]);
      this.getOrCreateCounter(
        METRIC_NAMES.JOBS_COMPLETED_TOTAL,
        'Total jobs completed successfully',
        ['queue'],
      );
      this.getOrCreateCounter(METRIC_NAMES.JOBS_FAILED_TOTAL, 'Total jobs failed', [
        'queue',
        'failure_type',
      ]);
      this.getOrCreateCounter(METRIC_NAMES.JOBS_RETRIED_TOTAL, 'Total jobs scheduled for retry', [
        'queue',
        'strategy',
      ]);
      this.getOrCreateCounter(
        METRIC_NAMES.JOBS_DEAD_LETTERED_TOTAL,
        'Total jobs moved to dead letter queue',
        ['queue'],
      );
      this.getOrCreateCounter(METRIC_NAMES.JOBS_CANCELLED_TOTAL, 'Total jobs cancelled', ['queue']);
      this.getOrCreateCounter(METRIC_NAMES.JOBS_DELETED_TOTAL, 'Total jobs deleted', ['queue']);
      this.getOrCreateCounter(
        METRIC_NAMES.JOB_IDEMPOTENCY_HITS_TOTAL,
        'Total job creation idempotency hits',
        ['queue'],
      );

      // Queue Counters & Gauges
      this.getOrCreateCounter(METRIC_NAMES.QUEUE_ENQUEUED_TOTAL, 'Total jobs enqueued', ['queue']);
      this.getOrCreateCounter(METRIC_NAMES.QUEUE_CLAIMED_TOTAL, 'Total jobs claimed', ['queue']);
      this.getOrCreateCounter(METRIC_NAMES.QUEUE_ACKNOWLEDGED_TOTAL, 'Total jobs acknowledged', [
        'queue',
      ]);
      this.getOrCreateGauge(METRIC_NAMES.QUEUE_DEPTH, 'Current queue depth', ['queue']);
      this.getOrCreateGauge(METRIC_NAMES.QUEUE_PROCESSING, 'Current jobs in processing state', [
        'queue',
      ]);
      this.getOrCreateGauge(METRIC_NAMES.QUEUE_SCHEDULED, 'Current scheduled jobs', ['queue']);
      this.getOrCreateGauge(METRIC_NAMES.QUEUE_DEADLETTER, 'Current deadletter jobs', ['queue']);

      // Worker Gauges & Histograms
      this.getOrCreateGauge(METRIC_NAMES.WORKER_ACTIVE, 'Active worker count', [
        'workerId',
        'queue',
      ]);
      this.getOrCreateGauge(METRIC_NAMES.WORKER_BUSY, 'Busy worker count', ['workerId', 'queue']);
      this.getOrCreateGauge(METRIC_NAMES.WORKER_CONCURRENCY, 'Configured worker concurrency', [
        'workerId',
        'queue',
      ]);
      this.getOrCreateHistogram(
        METRIC_NAMES.WORKER_JOB_DURATION_MS,
        'Worker job execution duration in milliseconds',
        ['queue', 'status'],
        DEFAULT_LATENCY_BUCKETS_MS,
      );

      // Latency Histograms
      this.getOrCreateHistogram(
        METRIC_NAMES.JOB_EXECUTION_DURATION_MS,
        'Job execution duration in milliseconds',
        ['queue', 'status'],
        DEFAULT_LATENCY_BUCKETS_MS,
      );
      this.getOrCreateHistogram(
        METRIC_NAMES.JOB_QUEUE_WAIT_DURATION_MS,
        'Job queue wait duration in milliseconds',
        ['queue'],
        DEFAULT_LATENCY_BUCKETS_MS,
      );
      this.getOrCreateHistogram(
        METRIC_NAMES.JOB_RETRY_DELAY_MS,
        'Job retry delay in milliseconds',
        ['queue', 'strategy'],
        DEFAULT_LATENCY_BUCKETS_MS,
      );

      // Scheduler Metrics
      this.getOrCreateGauge(METRIC_NAMES.SCHEDULER_LAG_MS, 'Scheduler lag in milliseconds');
      this.getOrCreateCounter(
        METRIC_NAMES.SCHEDULER_TICKS_TOTAL,
        'Total scheduler tick executions',
      );
      this.getOrCreateCounter(
        METRIC_NAMES.SCHEDULER_FAILURES_TOTAL,
        'Total scheduler execution failures',
      );

      // API Metrics
      this.getOrCreateCounter(METRIC_NAMES.API_REQUESTS_TOTAL, 'Total API HTTP requests', [
        'method',
        'route',
        'status_code',
      ]);
      this.getOrCreateHistogram(
        METRIC_NAMES.API_REQUEST_DURATION_MS,
        'API HTTP request duration in milliseconds',
        ['method', 'route', 'status_code'],
        API_LATENCY_BUCKETS_MS,
      );

      // Database & Redis Metrics
      this.getOrCreateHistogram(
        METRIC_NAMES.DB_QUERY_DURATION_MS,
        'Database query duration in milliseconds',
        ['operation'],
        DB_LATENCY_BUCKETS_MS,
      );
      this.getOrCreateGauge(METRIC_NAMES.DB_POOL_ACTIVE, 'PostgreSQL pool active connections');
      this.getOrCreateGauge(METRIC_NAMES.DB_POOL_IDLE, 'PostgreSQL pool idle connections');
      this.getOrCreateGauge(METRIC_NAMES.DB_POOL_WAITING, 'PostgreSQL pool waiting clients');
      this.getOrCreateHistogram(
        METRIC_NAMES.REDIS_OPERATION_DURATION_MS,
        'Redis operation duration in milliseconds',
        ['command'],
        REDIS_LATENCY_BUCKETS_MS,
      );

      // Recovery Metrics
      this.getOrCreateCounter(METRIC_NAMES.RECOVERY_SCANS_TOTAL, 'Total recovery scans executed');
      this.getOrCreateCounter(METRIC_NAMES.JOBS_RECOVERED_TOTAL, 'Total jobs recovered');
      this.getOrCreateCounter(
        METRIC_NAMES.JOBS_RECOVERY_FAILED_TOTAL,
        'Total job recovery failures',
      );
      this.getOrCreateGauge(METRIC_NAMES.JOBS_STALE_TOTAL, 'Current stale jobs count');
      this.getOrCreateCounter(METRIC_NAMES.JOBS_RECONCILED_TOTAL, 'Total jobs reconciled');
      this.getOrCreateCounter(
        METRIC_NAMES.REDIS_ORPHANS_REMOVED_TOTAL,
        'Total orphan Redis job IDs removed',
      );
      this.getOrCreateHistogram(
        METRIC_NAMES.RECOVERY_DURATION_MS,
        'Recovery scan execution duration in milliseconds',
        [],
        DEFAULT_LATENCY_BUCKETS_MS,
      );
      this.getOrCreateCounter(
        METRIC_NAMES.RECOVERY_CONFLICTS_TOTAL,
        'Total recovery race conflicts',
      );
    } catch (err: unknown) {
      errorLogger.error('Error initializing core Prometheus metrics', { error: String(err) });
    }
  }

  public getOrCreateCounter(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): Counter<string> {
    if (this.counters.has(name)) {
      return this.counters.get(name)!;
    }
    const counter = new Counter({
      name,
      help,
      labelNames,
      registers: [this.registry],
    });
    this.counters.set(name, counter);
    return counter;
  }

  public getOrCreateGauge(name: string, help: string, labelNames: string[] = []): Gauge<string> {
    if (this.gauges.has(name)) {
      return this.gauges.get(name)!;
    }
    const gauge = new Gauge({
      name,
      help,
      labelNames,
      registers: [this.registry],
    });
    this.gauges.set(name, gauge);
    return gauge;
  }

  public getOrCreateHistogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets: number[] = DEFAULT_LATENCY_BUCKETS_MS,
  ): Histogram<string> {
    if (this.histograms.has(name)) {
      return this.histograms.get(name)!;
    }
    const histogram = new Histogram({
      name,
      help,
      labelNames,
      buckets,
      registers: [this.registry],
    });
    this.histograms.set(name, histogram);
    return histogram;
  }

  public incrementCounter(
    name: string,
    value: number = 1,
    labels: Record<string, string> = {},
  ): void {
    if (!this.enabled) return;
    try {
      const counter = this.counters.get(name);
      if (counter) {
        counter.inc(labels, value);
      }
    } catch (err) {
      appLogger.debug('Telemetry error in incrementCounter', { name, error: String(err) });
    }
  }

  public recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.enabled) return;
    try {
      const histogram = this.histograms.get(name);
      if (histogram) {
        histogram.observe(labels, value);
      }
    } catch (err) {
      appLogger.debug('Telemetry error in recordHistogram', { name, error: String(err) });
    }
  }

  public setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.enabled) return;
    try {
      const gauge = this.gauges.get(name);
      if (gauge) {
        gauge.set(labels, value);
      }
    } catch (err) {
      appLogger.debug('Telemetry error in setGauge', { name, error: String(err) });
    }
  }

  public async getMetricsText(): Promise<string> {
    try {
      return await this.registry.metrics();
    } catch (err) {
      errorLogger.error('Error fetching metrics from registry', { error: String(err) });
      return '# Error rendering metrics\n';
    }
  }

  public getContentType(): string {
    return this.registry.contentType;
  }

  public clear(): void {
    try {
      this.registry.clear();
      this.counters.clear();
      this.gauges.clear();
      this.histograms.clear();
    } catch {
      // Ignore clear errors
    }
  }
}

export const prometheusRegistry = new PrometheusRegistry();
