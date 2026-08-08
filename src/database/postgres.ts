import pg from 'pg';
import { databaseConfig } from '../config/database.js';
import { appLogger, errorLogger } from '../logger/logger.js';
import { prometheusRegistry } from '../observability/prometheus.js';
import { METRIC_NAMES } from '../observability/observability.constants.js';

const { Pool } = pg;

export const pgPool = new Pool({
  host: databaseConfig.host,
  port: databaseConfig.port,
  database: databaseConfig.database,
  user: databaseConfig.user,
  password: databaseConfig.password,
  max: databaseConfig.maxConnections,
});

pgPool.on('error', (err) => {
  errorLogger.error('Unexpected PostgreSQL pool error', { error: err.message, stack: err.stack });
});

export const checkPostgresConnection = async (): Promise<boolean> => {
  try {
    const client = await pgPool.connect();
    const result = await client.query<{ now: Date }>('SELECT NOW()');
    client.release();
    appLogger.info('PostgreSQL connection established successfully', {
      timestamp: result.rows[0]?.now ? result.rows[0].now.toISOString() : undefined,
    });
    return true;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errorLogger.error(
      `PostgreSQL Connection Failed\n  Host: ${databaseConfig.host}\n  Port: ${databaseConfig.port}\n  Reason: ${errorMsg}\n  Suggestion: Start PostgreSQL using Docker Compose ('docker compose up -d postgres').`,
      {
        host: databaseConfig.host,
        port: databaseConfig.port,
        reason: errorMsg,
        suggestion: "Start PostgreSQL using Docker Compose ('docker compose up -d postgres').",
      },
    );
    return false;
  }
};

export const recordPostgresPoolMetrics = (): void => {
  try {
    prometheusRegistry.setGauge(METRIC_NAMES.DB_POOL_ACTIVE, pgPool.totalCount - pgPool.idleCount);
    prometheusRegistry.setGauge(METRIC_NAMES.DB_POOL_IDLE, pgPool.idleCount);
    prometheusRegistry.setGauge(METRIC_NAMES.DB_POOL_WAITING, pgPool.waitingCount);
  } catch {
    // Ignore metric collection errors
  }
};

export const closePostgresConnection = async (): Promise<void> => {
  try {
    await pgPool.end();
    appLogger.info('PostgreSQL connection pool closed');
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errorLogger.error('Error closing PostgreSQL connection pool', { error: errorMsg });
  }
};
