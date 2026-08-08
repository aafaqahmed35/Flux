import crypto from 'node:crypto';
import { AUTH_DEFAULTS, ROLE_SCOPES_MAP } from './auth.constants.js';
import { InvalidApiKeyError } from './auth.errors.js';
import { authRepository, AuthRepository } from './auth.repository.js';
import { ApiKey, ApiKeyScope, AuthContext } from './auth.types.js';
import { appLogger } from '../logger/logger.js';

export class ApiKeyService {
  private readonly repository: AuthRepository;

  constructor(repository: AuthRepository = authRepository) {
    this.repository = repository;
  }

  public hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  async createApiKey(data: {
    userId: string;
    name: string;
    scopes?: ApiKeyScope[];
    expiresAt?: Date | null;
  }): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const user = await this.repository.findUserById(data.userId);
    if (!user || !user.enabled) {
      throw new Error(`Cannot create API key for disabled or non-existent user '${data.userId}'`);
    }

    const secretBytes = crypto.randomBytes(24).toString('hex');
    const rawKey = `${AUTH_DEFAULTS.apiKeyPrefix}${secretBytes}`;
    const keyHash = this.hashKey(rawKey);

    const defaultScopes = data.scopes || (ROLE_SCOPES_MAP[user.role] as ApiKeyScope[]) || [];

    const apiKey = await this.repository.createApiKey({
      userId: data.userId,
      name: data.name,
      keyPrefix: AUTH_DEFAULTS.apiKeyPrefix,
      keyHash,
      scopes: defaultScopes,
      expiresAt: data.expiresAt,
    });

    appLogger.info('API key created', {
      keyId: apiKey.id,
      userId: data.userId,
      name: data.name,
    });

    return { apiKey, rawKey };
  }

  async verifyApiKey(rawKey: string): Promise<AuthContext> {
    if (!rawKey || typeof rawKey !== 'string') {
      throw new InvalidApiKeyError();
    }

    const keyHash = this.hashKey(rawKey);
    const apiKey = await this.repository.findApiKeyByHash(keyHash);

    if (!apiKey || !apiKey.enabled || apiKey.revokedAt) {
      throw new InvalidApiKeyError();
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() < Date.now()) {
      throw new InvalidApiKeyError('API key has expired');
    }

    const user = await this.repository.findUserById(apiKey.userId);
    if (!user || !user.enabled) {
      throw new InvalidApiKeyError('User associated with API key is disabled');
    }

    void this.repository.touchApiKeyLastUsed(apiKey.id);

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      scopes: apiKey.scopes,
      authType: 'API_KEY',
      apiKeyId: apiKey.id,
    };
  }

  async revokeApiKey(id: string, userId: string): Promise<boolean> {
    const apiKey = await this.repository.findApiKeyById(id);
    if (!apiKey || apiKey.userId !== userId) {
      return false;
    }
    const revoked = await this.repository.revokeApiKey(id);
    if (revoked) {
      appLogger.info('API key revoked', { keyId: id, userId });
    }
    return revoked;
  }

  async listApiKeys(userId: string): Promise<ApiKey[]> {
    return this.repository.listApiKeysByUser(userId);
  }

  async rotateApiKey(id: string, userId: string): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const existing = await this.repository.findApiKeyById(id);
    if (!existing || existing.userId !== userId) {
      throw new Error(`API key '${id}' not found or unauthorized`);
    }

    await this.revokeApiKey(id, userId);

    return this.createApiKey({
      userId,
      name: `${existing.name} (Rotated)`,
      scopes: existing.scopes,
      expiresAt: existing.expiresAt,
    });
  }
}

export const apiKeyService = new ApiKeyService();
