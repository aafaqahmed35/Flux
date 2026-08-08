import { PrometheusRegistry } from '../../src/observability/prometheus.js';

describe('PrometheusRegistry Unit Tests', () => {
  let registry: PrometheusRegistry;

  beforeEach(() => {
    registry = new PrometheusRegistry({ collectDefaultMetrics: false });
  });

  afterEach(() => {
    registry.clear();
  });

  it('should register and increment counters correctly', async () => {
    const counter = registry.getOrCreateCounter('test_counter_total', 'Test counter', ['queue']);
    expect(counter).toBeDefined();

    registry.incrementCounter('test_counter_total', 2, { queue: 'emails' });

    const metricsText = await registry.getMetricsText();
    expect(metricsText).toContain('test_counter_total{queue="emails"} 2');
  });

  it('should set gauge values correctly', async () => {
    const gauge = registry.getOrCreateGauge('test_gauge_value', 'Test gauge', ['workerId']);
    expect(gauge).toBeDefined();

    registry.setGauge('test_gauge_value', 5, { workerId: 'w-1' });

    const metricsText = await registry.getMetricsText();
    expect(metricsText).toContain('test_gauge_value{workerId="w-1"} 5');
  });

  it('should record histogram observations', async () => {
    const histogram = registry.getOrCreateHistogram(
      'test_histogram_ms',
      'Test histogram',
      ['status'],
      [10, 50, 100],
    );
    expect(histogram).toBeDefined();

    registry.recordHistogram('test_histogram_ms', 25, { status: 'COMPLETED' });

    const metricsText = await registry.getMetricsText();
    expect(metricsText).toContain('test_histogram_ms_sum{status="COMPLETED"} 25');
    expect(metricsText).toContain('test_histogram_ms_count{status="COMPLETED"} 1');
  });

  it('should handle duplicate metric registration idempotently', () => {
    const c1 = registry.getOrCreateCounter('dup_counter', 'Dup counter');
    const c2 = registry.getOrCreateCounter('dup_counter', 'Dup counter');
    expect(c1).toBe(c2);
  });

  it('should not record metrics when disabled', async () => {
    registry.setEnabled(false);
    registry.getOrCreateCounter('disabled_counter', 'Disabled counter');
    registry.incrementCounter('disabled_counter', 10);

    const metricsText = await registry.getMetricsText();
    expect(metricsText).not.toContain('disabled_counter 10');
  });
});
