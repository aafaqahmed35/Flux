import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(18082),
  APP_NAME: z.string().default('Flux'),
  APP_VERSION: z.string().default('1.0.0'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
  TZ: z.string().default('UTC'),

  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(15433),
  POSTGRES_DB: z.string().default('flux_db'),
  POSTGRES_USER: z.string().default('flux_user'),
  POSTGRES_PASSWORD: z.string().default('flux_password'),
  POSTGRES_MAX_CONNECTIONS: z.coerce.number().default(20),
  DATABASE_URL: z.string().optional(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(16379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.coerce.number().default(0),

  ADMINER_PORT: z.coerce.number().default(18086),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  // Safe console format during bootstrap initialization
  process.stderr.write(
    `Invalid environment configuration:\n${JSON.stringify(parsedEnv.error.format(), null, 2)}\n`,
  );
  process.exit(1);
}

export const env = parsedEnv.data;
export type EnvSchema = z.infer<typeof envSchema>;
