export interface IObservability {
  incrementCounter(name: string, value?: number, labels?: Record<string, string>): void;
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): unknown;
  endSpan(span: unknown): void;
  recordException(span: unknown, error: Error | string): void;
  addEvent(
    span: unknown,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void;
  shutdown(): Promise<void>;
}
