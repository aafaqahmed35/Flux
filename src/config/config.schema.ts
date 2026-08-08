import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_NAME: z.string().default('Flux'),
  APP_VERSION: z.string().default('1.0.0'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
  TZ: z.string().default('UTC'),

  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(15433),
  POSTGRES_DB: z.string().default('flux_db'),
  POSTGRES_USER: z.string().default('flux_user'),
  POSTGRES_PASSWORD: z.string().default('flux_password'),
  POSTGRES_MAX_CONNECTIONS: z.coerce.number().int().positive().default(20),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(16379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.coerce.number().int().min(0).default(0),

  AUTH_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  JWT_SECRET: z.string().default('flux-super-secret-dev-jwt-key-do-not-use-in-prod'),
  JWT_ACCESS_TOKEN_TTL: z.string().default('1h'),

  RATE_LIMIT_ENABLED: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),

  SCHEDULER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  SCHEDULER_LEADER_TTL_MS: z.coerce.number().int().positive().default(15000),

  OTEL_SERVICE_NAME: z.string().default('flux'),
  OTEL_TRACES_EXPORTER: z.string().default('otlp'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnvConfig(envInput: Record<string, unknown> = process.env): EnvConfig {
  const result = envSchema.safeParse(envInput);
  if (!result.success) {
    const formattedErrors = result.error.format();
    const errorMessage = `Invalid environment configuration:\n${JSON.stringify(formattedErrors, null, 2)}`;
    throw new Error(errorMessage);
  }
  return result.data;
}
