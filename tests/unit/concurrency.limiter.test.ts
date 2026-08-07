import { ConcurrencyLimiter } from '../../src/workers/concurrency.limiter.js';

describe('ConcurrencyLimiter (Unit Tests)', () => {
  it('should acquire tokens up to configured limit', () => {
    const limiter = new ConcurrencyLimiter(2);

    expect(limiter.available).toBe(2);
    expect(limiter.active).toBe(0);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.active).toBe(1);
    expect(limiter.available).toBe(1);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.active).toBe(2);
    expect(limiter.isFull).toBe(true);

    expect(limiter.tryAcquire()).toBe(false);
  });

  it('should release tokens correctly', () => {
    const limiter = new ConcurrencyLimiter(1);
    limiter.tryAcquire();

    expect(limiter.isFull).toBe(true);

    limiter.release();
    expect(limiter.active).toBe(0);
    expect(limiter.isFull).toBe(false);
  });
});
