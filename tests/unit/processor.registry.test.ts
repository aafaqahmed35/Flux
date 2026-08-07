import { ProcessorRegistry } from '../../src/workers/processor.registry.js';
import { JobProcessor } from '../../src/workers/processor.interface.js';

describe('ProcessorRegistry (Unit Tests)', () => {
  let registry: ProcessorRegistry;

  beforeEach(() => {
    registry = new ProcessorRegistry();
  });

  it('should register and retrieve a job processor', () => {
    const mockProcessor: JobProcessor = {
      execute: jest.fn().mockResolvedValue({ processed: true }),
    };

    registry.registerProcessor('emails', mockProcessor);

    const retrieved = registry.getProcessor('emails');
    expect(retrieved).toBe(mockProcessor);
    expect(registry.listProcessors()).toEqual(['emails']);
  });

  it('should remove a registered processor', () => {
    const mockProcessor: JobProcessor = {
      execute: jest.fn().mockResolvedValue(true),
    };

    registry.registerProcessor('payments', mockProcessor);
    expect(registry.removeProcessor('payments')).toBe(true);
    expect(registry.getProcessor('payments')).toBeUndefined();
  });
});
