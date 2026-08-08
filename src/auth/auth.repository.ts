import { pgPool } from '../database/postgres.js';
import { ApiKey, ApiKeyScope, SecurityAuditLogEntry, User, UserRole } from './auth.types.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  enabled: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  enabled: boolean;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
}

export class AuthRepository {
  private mapUserRow(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role,
      enabled: row.enabled,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapApiKeyRow(row: ApiKeyRow): ApiKey {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      keyPrefix: row.key_prefix,
      keyHash: row.key_hash,
      scopes: row.scopes as ApiKeyScope[],
      enabled: row.enabled,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    };
  }

  async createUser(data: { email: string; passwordHash: string; role: UserRole }): Promise<User> {
    const res = await pgPool.query<UserRow>(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.email, data.passwordHash, data.role],
    );
    return this.mapUserRow(res.rows[0]!);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const res = await pgPool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    if (res.rows.length === 0) return null;
    return this.mapUserRow(res.rows[0]!);
  }

  async findUserById(id: string): Promise<User | null> {
    const res = await pgPool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapUserRow(res.rows[0]!);
  }

  async updateLastLogin(id: string): Promise<void> {
    await pgPool.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [
      id,
    ]);
  }

  async createApiKey(data: {
    userId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
    scopes: ApiKeyScope[];
    expiresAt?: Date | null;
  }): Promise<ApiKey> {
    const res = await pgPool.query<ApiKeyRow>(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.userId, data.name, data.keyPrefix, data.keyHash, data.scopes, data.expiresAt || null],
    );
    return this.mapApiKeyRow(res.rows[0]!);
  }

  async findApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    const res = await pgPool.query<ApiKeyRow>('SELECT * FROM api_keys WHERE key_hash = $1', [
      keyHash,
    ]);
    if (res.rows.length === 0) return null;
    return this.mapApiKeyRow(res.rows[0]!);
  }

  async findApiKeyById(id: string): Promise<ApiKey | null> {
    const res = await pgPool.query<ApiKeyRow>('SELECT * FROM api_keys WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapApiKeyRow(res.rows[0]!);
  }

  async listApiKeysByUser(userId: string): Promise<ApiKey[]> {
    const res = await pgPool.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return res.rows.map((row) => this.mapApiKeyRow(row));
  }

  async revokeApiKey(id: string): Promise<boolean> {
    const res = await pgPool.query(
      'UPDATE api_keys SET enabled = FALSE, revoked_at = NOW() WHERE id = $1 AND enabled = TRUE',
      [id],
    );
    return (res.rowCount || 0) > 0;
  }

  async touchApiKeyLastUsed(id: string): Promise<void> {
    await pgPool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [id]);
  }

  async addAuditLog(entry: SecurityAuditLogEntry): Promise<void> {
    await pgPool.query(
      `INSERT INTO security_audit_log (user_id, action, resource_type, resource_id, ip_address, user_agent, correlation_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.userId || null,
        entry.action,
        entry.resourceType || null,
        entry.resourceId || null,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.correlationId || null,
        entry.metadata || {},
      ],
    );
  }
}

export const authRepository = new AuthRepository();
