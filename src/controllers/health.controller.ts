import { Request, Response } from 'express';
import { serverConfig } from '../config/server.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';
import { getAppliedMigrations } from '../database/migrator.js';
import { pgPool } from '../database/postgres.js';
import { queueService } from '../queue/queue.service.js';
import { redisClient } from '../redis/redis.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const parseRedisInfo = (infoRaw: string): Record<string, string> => {
  const result: Record<string, string> = {};
  infoRaw.split('\r\n').forEach((line) => {
    if (line && !line.startsWith('#')) {
      const [key, val] = line.split(':');
      if (key && val) {
        result[key.trim()] = val.trim();
      }
    }
  });
  return result;
};

export const getHealth = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  let dbStatus = 'DOWN';
  let dbLatencyMs = -1;
  try {
    const start = Date.now();
    await pgPool.query('SELECT NOW()');
    dbLatencyMs = Date.now() - start;
    dbStatus = 'UP';
  } catch {
    dbStatus = 'DOWN';
  }

  let redisStatus = 'DOWN';
  let redisLatencyMs = -1;
  let redisVersion = 'UNKNOWN';
  let redisUptimeSeconds = -1;
  let redisRole = 'UNKNOWN';
  let usedMemoryHuman = 'UNKNOWN';
  let connectedClients = -1;

  try {
    if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
      await redisClient.connect();
    }
    const start = Date.now();
    const resPing = await redisClient.ping();
    if (resPing === 'PONG') {
      redisLatencyMs = Date.now() - start;
      redisStatus = 'UP';

      const infoRaw = await redisClient.info();
      const parsedInfo = parseRedisInfo(infoRaw);

      redisVersion = parsedInfo['redis_version'] ?? 'UNKNOWN';
      redisUptimeSeconds = Number(parsedInfo['uptime_in_seconds'] ?? -1);
      redisRole = parsedInfo['role'] ?? 'UNKNOWN';
      usedMemoryHuman = parsedInfo['used_memory_human'] ?? 'UNKNOWN';
      connectedClients = Number(parsedInfo['connected_clients'] ?? -1);
    }
  } catch {
    redisStatus = 'DOWN';
  }

  let migrationStatus = 'UNKNOWN';
  let appliedCount = 0;
  let latestMigration: string | null = null;
  try {
    const applied = await getAppliedMigrations();
    appliedCount = applied.length;
    latestMigration = applied.length > 0 ? (applied[applied.length - 1]?.name ?? null) : null;
    migrationStatus = 'UP';
  } catch {
    migrationStatus = 'ERROR';
  }

  let queueMetrics = {
    pending: 0,
    queued: 0,
    processing: 0,
    scheduled: 0,
    deadletter: 0,
    activeWorkers: 0,
  };

  try {
    queueMetrics = await queueService.getMetrics();
  } catch {
    // Graceful fallback if queue metrics error out
  }

  const overallStatus = dbStatus === 'UP' && redisStatus === 'UP' ? 'UP' : 'DEGRADED';
  const statusCode = overallStatus === 'UP' ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE;

  const healthData = {
    status: overallStatus,
    service: serverConfig.appName,
    version: serverConfig.appVersion,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    components: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      redis: {
        status: redisStatus,
        latencyMs: redisLatencyMs,
        version: redisVersion,
        uptimeSeconds: redisUptimeSeconds,
        role: redisRole,
        usedMemory: usedMemoryHuman,
        connectedClients,
      },
      migrations: {
        status: migrationStatus,
        appliedCount,
        latest: latestMigration,
      },
      queue: queueMetrics,
    },
  };

  res.status(statusCode).json(healthData);
});
