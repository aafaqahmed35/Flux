import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { appLogger, errorLogger } from '../logger/logger.js';

export interface OpenTelemetryConfig {
  serviceName?: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  enabled?: boolean;
}

export class OpenTelemetryManager {
  private sdk: NodeSDK | null = null;
  private isStarted: boolean = false;
  private enabled: boolean = true;

  constructor(config?: OpenTelemetryConfig) {
    const serviceName = config?.serviceName || process.env.OTEL_SERVICE_NAME || 'flux';
    const serviceVersion = config?.serviceVersion || process.env.OTEL_SERVICE_VERSION || '1.0.0';
    const otlpEndpoint =
      config?.otlpEndpoint ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      'http://localhost:4318/v1/traces';
    const tracesExporter = process.env.OTEL_TRACES_EXPORTER || 'otlp';

    this.enabled =
      config?.enabled !== undefined ? config.enabled : process.env.TRACING_ENABLED !== 'false';

    if (!this.enabled || tracesExporter === 'none') {
      appLogger.info('OpenTelemetry tracing is disabled');
      return;
    }

    try {
      const traceExporter = new OTLPTraceExporter({
        url: otlpEndpoint.endsWith('/v1/traces') ? otlpEndpoint : `${otlpEndpoint}/v1/traces`,
      });

      this.sdk = new NodeSDK({
        serviceName,
        traceExporter,
        instrumentations: [
          getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-fs': { enabled: false },
            '@opentelemetry/instrumentation-dns': { enabled: false },
            '@opentelemetry/instrumentation-net': { enabled: false },
            '@opentelemetry/instrumentation-express': { enabled: true },
            '@opentelemetry/instrumentation-http': { enabled: true },
            '@opentelemetry/instrumentation-pg': { enabled: true },
            '@opentelemetry/instrumentation-ioredis': { enabled: true },
          }),
        ],
      });

      appLogger.info('OpenTelemetry SDK initialized', {
        serviceName,
        serviceVersion,
        otlpEndpoint,
      });
    } catch (err) {
      errorLogger.error('Failed to initialize OpenTelemetry SDK', { error: String(err) });
      this.sdk = null;
    }
  }

  public async start(): Promise<void> {
    if (!this.sdk || this.isStarted || !this.enabled) return;

    try {
      await Promise.resolve(this.sdk.start());
      this.isStarted = true;
      appLogger.info('OpenTelemetry SDK started successfully');
    } catch (err) {
      errorLogger.error('Error starting OpenTelemetry SDK', { error: String(err) });
      // Failure isolation: telemetry error never crashes the app
    }
  }

  public async shutdown(): Promise<void> {
    if (!this.sdk || !this.isStarted) return;

    try {
      await this.sdk.shutdown();
      this.isStarted = false;
      appLogger.info('OpenTelemetry SDK shut down successfully');
    } catch (err) {
      errorLogger.error('Error shutting down OpenTelemetry SDK', { error: String(err) });
    }
  }

  public isRunning(): boolean {
    return this.isStarted;
  }
}

export const openTelemetryManager = new OpenTelemetryManager();
