export class ConcurrencyLimiter {
  private readonly maxConcurrency: number;
  private activeCount = 0;

  constructor(maxConcurrency = 4) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  tryAcquire(): boolean {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return true;
    }
    return false;
  }

  release(): void {
    if (this.activeCount > 0) {
      this.activeCount--;
    }
  }

  get active(): number {
    return this.activeCount;
  }

  get limit(): number {
    return this.maxConcurrency;
  }

  get available(): number {
    return Math.max(0, this.maxConcurrency - this.activeCount);
  }

  get isFull(): boolean {
    return this.activeCount >= this.maxConcurrency;
  }
}
