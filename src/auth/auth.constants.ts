export const isAuthEnabled = (): boolean => {
  return process.env.AUTH_ENABLED === 'true';
};

export const AUTH_DEFAULTS = {
  get jwtSecret() {
    return process.env.JWT_SECRET || 'flux-super-secret-dev-jwt-key-do-not-use-in-prod';
  },
  get jwtExpiresIn() {
    return process.env.JWT_ACCESS_TOKEN_TTL || '1h';
  },
  get apiKeyPrefix() {
    return process.env.API_KEY_PREFIX || 'flux_live_';
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
  ],
  VIEWER: [
    'jobs:read',
    'queues:read',
    'workers:read',
    'retries:read',
    'deadletter:read',
    'schedules:read',
    'metrics:read',
  ],
};
