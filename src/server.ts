import { Server } from 'http';
import app from './app.js';
import { serverConfig } from './config/server.js';
import { appLogger, errorLogger } from './logger/logger.js';
import { databaseConfig } from './config/database.js';
import { redisConfig } from './config/redis.js';
import { env } from './config/env.js';
import { checkPostgresConnection, closePostgresConnection } from './database/postgres.js';
import { checkRedisConnection, closeRedisConnection } from './redis/redis.js';

let server: Server;

const startServer = async (): Promise<void> => {
  try {
    appLogger.info(
      `Bootstrapping ${serverConfig.appName} v${serverConfig.appVersion} [${serverConfig.env}]...`,
    );

    // Verify PostgreSQL and Redis infrastructure connectivity on boot (non-blocking for dev flexibility)
    const isPgConnected = await checkPostgresConnection();
    const isRedisConnected = await checkRedisConnection();

    if (!isPgConnected) {
      appLogger.warn(
        'PostgreSQL connection check failed during startup. Server will start, but database tasks may fail until connected.',
      );
    }

    if (!isRedisConnected) {
      appLogger.warn(
        'Redis connection check failed during startup. Server will start, but cache/queue tasks may fail until connected.',
      );
    }

    server = app.listen(serverConfig.port, () => {
      appLogger.info(
        `${serverConfig.appName} server listening at http://localhost:${serverConfig.port} in ${serverConfig.env} mode`,
      );
      appLogger.info('Flux Service Endpoints:', {
        api: `http://localhost:${serverConfig.port}`,
        postgres: `${databaseConfig.host}:${databaseConfig.port}`,
        redis: `${redisConfig.host}:${redisConfig.port}`,
        adminer: `http://localhost:${env.ADMINER_PORT}`,
      });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        errorLogger.error(
          `Port ${serverConfig.port} is already in use.\nPossible solutions:\n• Stop the existing process running on port ${serverConfig.port}\n• Change PORT in .env\nFlux is shutting down gracefully.`,
          {
            port: serverConfig.port,
            code: err.code,
            solutions: [
              `Stop the existing process running on port ${serverConfig.port}`,
              'Change PORT in .env',
            ],
          },
        );
        process.exit(1);
      } else {
        errorLogger.error('Server encountered a fatal error', {
          error: err.message,
          stack: err.stack,
        });
        process.exit(1);
      }
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errorLogger.error('Failed to start server', { error: errorMsg });
    process.exit(1);
  }
};

const gracefulShutdown = async (signal: string): Promise<void> => {
  appLogger.info(`Received ${signal}. Initiating graceful shutdown...`);

  if (server) {
    server.close(() => {
      void (async (): Promise<void> => {
        appLogger.info('HTTP server closed.');
        await closePostgresConnection();
        await closeRedisConnection();
        appLogger.info('All connections terminated. Exiting process.');
        process.exit(0);
      })();
    });

    // Force exit after 10 seconds timeout
    setTimeout(() => {
      errorLogger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000).unref();
  } else {
    await closePostgresConnection();
    await closeRedisConnection();
    process.exit(0);
  }
};

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason: unknown) => {
  errorLogger.error('Unhandled Promise Rejection', { reason });
});

process.on('uncaughtException', (error: Error) => {
  errorLogger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  void gracefulShutdown('uncaughtException');
});

void startServer();
