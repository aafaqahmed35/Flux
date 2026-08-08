import { TracingHelper } from '../../src/observability/tracing.js';

describe('TracingHelper Unit Tests', () => {
  let tracer: TracingHelper;

  beforeEach(() => {
    tracer = new TracingHelper(true);
  });

  it('should start and end spans gracefully', () => {
    const span = tracer.startSpan('test.span', { 'test.attr': 'value' });
    expect(span).toBeDefined();

    tracer.addEvent(span, 'custom_event', { key: 'val' });
    tracer.endSpan(span, 'OK');
  });

  it('should record exceptions on spans', () => {
    const span = tracer.startSpan('test.error_span');
    expect(span).toBeDefined();

    const err = new Error('Test tracing failure');
    tracer.recordException(span, err);
    tracer.endSpan(span, 'ERROR', err.message);
  });

  it('should return null span when disabled', () => {
    tracer.setEnabled(false);
    const span = tracer.startSpan('disabled.span');
    expect(span).toBeNull();

    // Verification that helper handles null spans safely
    tracer.addEvent(span, 'event');
    tracer.recordException(span, 'error');
    tracer.endSpan(span);
  });
});
