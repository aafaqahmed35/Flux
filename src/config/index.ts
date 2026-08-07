import { serverConfig } from './server.js';
import { databaseConfig } from './database.js';
import { redisConfig } from './redis.js';
import { loggerConfig } from './logger.js';
import { AppConfig } from '../interfaces/config.interface.js';

export const config: AppConfig = {
  server: serverConfig,
  database: databaseConfig,
  redis: redisConfig,
  logger: loggerConfig,
};

export { serverConfig, databaseConfig, redisConfig, loggerConfig };
export default config;
