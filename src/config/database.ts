import { env } from './env.js';
import { DatabaseConfig } from '../interfaces/config.interface.js';

export const databaseConfig: DatabaseConfig = {
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  database: env.POSTGRES_DB,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  maxConnections: env.POSTGRES_MAX_CONNECTIONS,
  url:
    env.DATABASE_URL ||
    `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`,
};
