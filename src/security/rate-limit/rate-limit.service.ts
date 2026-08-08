import { redisClient } from '../../redis/redis.js';
import { errorLogger } from '../../logger/logger.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export class RateLimitService {
  async checkRateLimit(
    contextName: string,
    identity: string,
    limit: number,
    windowSeconds = 60,
  ): Promise<RateLimitResult> {
    const key = `flux:ratelimit:${contextName}:${identity}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    try {
      if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
        // Fallback gracefully if Redis is unavailable: allow request
        return { allowed: true, limit, remaining: limit - 1, resetSeconds: windowSeconds };
      }

      const pipeline = redisClient.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.zcard(key);
      pipeline.expire(key, windowSeconds);

      const results = await pipeline.exec();

      const currentCount = (results?.[2]?.[1] as number) || 1;
      const remaining = Math.max(0, limit - currentCount);
      const allowed = currentCount <= limit;

      return {
        allowed,
        limit,
        remaining,
        resetSeconds: windowSeconds,
      };
    } catch (err: unknown) {
      errorLogger.error('Rate limit check error in Redis', {
        contextName,
        identity,
        error: String(err),
      });
      return { allowed: true, limit, remaining: limit - 1, resetSeconds: windowSeconds };
    }
  }
}

export const rateLimitService = new RateLimitService();
