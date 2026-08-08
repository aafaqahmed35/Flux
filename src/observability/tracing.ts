import { trace, context, Span, SpanStatusCode, AttributeValue } from '@opentelemetry/api';
import { appLogger } from '../logger/logger.js';
import { SpanContext } from './observability.types.js';

export class TracingHelper {
  private readonly tracerName = 'flux-tracer';
  private enabled: boolean = true;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public startSpan(name: string, attributes?: Record<string, AttributeValue>): Span | null {
    if (!this.enabled) return null;
    try {
      const tracer = trace.getTracer(this.tracerName);
      const span = tracer.startSpan(name, {
        attributes,
      });
      return span;
    } catch (err) {
      appLogger.debug('Tracing error in startSpan', { name, error: String(err) });
      return null;
    }
  }

  public endSpan(span: unknown, status: 'OK' | 'ERROR' = 'OK', message?: string): void {
    if (!span || typeof (span as Span).end !== 'function') return;
    try {
      const otelSpan = span as Span;
      if (status === 'ERROR') {
        otelSpan.setStatus({ code: SpanStatusCode.ERROR, message });
      } else {
        otelSpan.setStatus({ code: SpanStatusCode.OK });
      }
      otelSpan.end();
    } catch (err) {
      appLogger.debug('Tracing error in endSpan', { error: String(err) });
    }
  }

  public recordException(span: unknown, error: Error | string): void {
    if (!span || typeof (span as Span).recordException !== 'function') return;
    try {
      const otelSpan = span as Span;
      const errObj = typeof error === 'string' ? new Error(error) : error;
      otelSpan.recordException(errObj);
      otelSpan.setStatus({ code: SpanStatusCode.ERROR, message: errObj.message });
    } catch (err) {
      appLogger.debug('Tracing error in recordException', { error: String(err) });
    }
  }

  public addEvent(span: unknown, name: string, attributes?: Record<string, AttributeValue>): void {
    if (!span || typeof (span as Span).addEvent !== 'function') return;
    try {
      const otelSpan = span as Span;
      otelSpan.addEvent(name, attributes);
    } catch (err) {
      appLogger.debug('Tracing error in addEvent', { name, error: String(err) });
    }
  }

  public getActiveSpanContext(): SpanContext | null {
    try {
      const activeSpan = trace.getSpan(context.active());
      if (!activeSpan) return null;
      const spanCtx = activeSpan.spanContext();
      return {
        traceId: spanCtx.traceId,
        spanId: spanCtx.spanId,
        isSampled: Boolean(spanCtx.traceFlags),
      };
    } catch {
      return null;
    }
  }
}

export const tracingHelper = new TracingHelper();
