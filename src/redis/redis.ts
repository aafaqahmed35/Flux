import { Redis } from 'ioredis';
import { redisConfig } from '../config/redis.js';
import { appLogger, errorLogger } from '../logger/logger.js';

export const redisClient = new Redis({
  host: redisConfig.host,
  port: redisConfig.port,
  password: redisConfig.password,
  db: redisConfig.db,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redisClient.on('connect', () => {
  appLogger.info('Redis connection initiating...');
});

redisClient.on('ready', () => {
  appLogger.info('Redis client ready');
});

redisClient.on('error', (err) => {
  errorLogger.error('Redis client error encountered', { error: err.message });
});

redisClient.on('close', () => {
  appLogger.info('Redis connection closed');
});

export const checkRedisConnection = async (): Promise<boolean> => {
  try {
    if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
      await redisClient.connect();
    }
    const pingResult = await redisClient.ping();
    appLogger.info('Redis ping successful', { response: pingResult });
    return pingResult === 'PONG';
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errorLogger.error(
      `Redis Connection Failed\n  Host: ${redisConfig.host}\n  Port: ${redisConfig.port}\n  Reason: ${errorMsg}\n  Suggestion: Start Redis using Docker Compose ('docker compose up -d redis').`,
      {
        host: redisConfig.host,
        port: redisConfig.port,
        reason: errorMsg,
        suggestion: "Start Redis using Docker Compose ('docker compose up -d redis').",
      },
    );
    return false;
  }
};

export const closeRedisConnection = async (): Promise<void> => {
  try {
    if (redisClient.status !== 'end') {
      await redisClient.quit();
      appLogger.info('Redis connection disconnected gracefully');
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errorLogger.error('Error disconnecting Redis client', { error: errorMsg });
  }
};
