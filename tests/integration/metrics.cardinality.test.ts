import { prometheusRegistry } from '../../src/observability/prometheus.js';

describe('Metrics Label Cardinality Audit', () => {
  it('should not contain high-cardinality values like UUIDs or job IDs in metric output', async () => {
    const metricsText = await registryMetricsText();

    const sampleUuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(metricsText).not.toContain(`jobId="${sampleUuid}"`);
    expect(metricsText).not.toContain(`correlationId=`);
    expect(metricsText).not.toContain(`payload=`);
  });
});

async function registryMetricsText(): Promise<string> {
  return prometheusRegistry.getMetricsText();
}
