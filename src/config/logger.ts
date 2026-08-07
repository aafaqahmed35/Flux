import { env } from './env.js';
import { LoggerConfig } from '../interfaces/config.interface.js';

export const loggerConfig: LoggerConfig = {
  level: env.LOG_LEVEL,
};
