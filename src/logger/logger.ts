import winston from 'winston';
import { loggerConfig } from '../config/logger.js';
import { serverConfig } from '../config/server.js';

const isProduction = serverConfig.env === 'production';

const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, category, stack, ...meta }) => {
    const catStr = category ? `[${String(category)}]` : '[App]';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${String(stack)}` : '';
    return `${String(timestamp)} ${level} ${catStr}: ${String(message)}${metaStr}${stackStr}`;
  }),
);

const baseLogger = winston.createLogger({
  level: loggerConfig.level,
  format: isProduction ? customFormat : devFormat,
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
    }),
  ],
});

export const appLogger = baseLogger.child({ category: 'APPLICATION' });
export const httpLogger = baseLogger.child({ category: 'HTTP' });
export const errorLogger = baseLogger.child({ category: 'ERROR' });

/**
 * Extension point for future worker or job specific loggers
 */
export const createCategoryLogger = (category: string): winston.Logger => {
  return baseLogger.child({ category: category.toUpperCase() });
};

export default appLogger;
