import { env } from '../config/env.js';

export const isAuthEnabled = (): boolean => {
  return env.AUTH_ENABLED === 'true';
};

export const AUTH_DEFAULTS = {
  get jwtSecret() {
    return env.JWT_SECRET;
  },
  get jwtExpiresIn() {
    return env.JWT_ACCESS_TOKEN_TTL;
  },
  get apiKeyPrefix() {
    return env.API_KEY_PREFIX;
  },
  bcryptSaltRounds: 10,
  maxFailedLoginAttempts: 5,
} as const;

export const AUTH_HEADERS = {
  AUTHORIZATION: 'authorization',
  API_KEY: 'x-api-key',
} as const;

export const ROLE_SCOPES_MAP: Record<string, string[]> = {
  ADMIN: ['admin:*'],
  OPERATOR: [
    'jobs:read',
    'jobs:write',
    'jobs:cancel',
    'queues:read',
    'workers:read',
    'retries:read',
    'retries:write',
    'deadletter:read',
    'deadletter:write',
    'schedules:read',
    'schedules:write',
    'metrics:read',
    'recovery:read',
    'recovery:write',
  ],
  VIEWER: [
    'jobs:read',
    'queues:read',
    'workers:read',
    'retries:read',
    'deadletter:read',
    'schedules:read',
    'metrics:read',
    'recovery:read',
  ],
};
