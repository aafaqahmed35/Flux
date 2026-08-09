import { Request } from 'express';

export type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export type ApiKeyScope =
  | 'jobs:read'
  | 'jobs:write'
  | 'jobs:cancel'
  | 'jobs:delete'
  | 'queues:read'
  | 'workers:read'
  | 'retries:read'
  | 'retries:write'
  | 'deadletter:read'
  | 'deadletter:write'
  | 'schedules:read'
  | 'schedules:write'
  | 'metrics:read'
  | 'recovery:read'
  | 'recovery:write'
  | 'admin:*';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  enabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  enabled: boolean;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  scopes: ApiKeyScope[];
  authType: 'JWT' | 'API_KEY';
  apiKeyId?: string;
}

export interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}

export interface SecurityAuditLogEntry {
  id?: string;
  userId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}
