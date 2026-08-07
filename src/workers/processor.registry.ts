import { appLogger } from '../logger/logger.js';
import { JobProcessor } from './processor.interface.js';

export class ProcessorRegistry {
  private readonly processors = new Map<string, JobProcessor>();

  registerProcessor(queueName: string, processor: JobProcessor): void {
    this.processors.set(queueName, processor);
    appLogger.info('Processor Registered', { queueName });
  }

  getProcessor(queueName: string): JobProcessor | undefined {
    return this.processors.get(queueName);
  }

  removeProcessor(queueName: string): boolean {
    const removed = this.processors.delete(queueName);
    if (removed) {
      appLogger.info('Processor Removed', { queueName });
    }
    return removed;
  }

  listProcessors(): string[] {
    return Array.from(this.processors.keys());
  }

  get processorCount(): number {
    return this.processors.size;
  }

  clear(): void {
    this.processors.clear();
  }
}

export const processorRegistry = new ProcessorRegistry();
