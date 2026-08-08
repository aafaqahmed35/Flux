import { ApiKeyService } from '../../src/auth/api-key.service.js';
import { AuthRepository } from '../../src/auth/auth.repository.js';
import { InvalidApiKeyError } from '../../src/auth/auth.errors.js';

describe('ApiKeyService', () => {
  let mockRepository: jest.Mocked<AuthRepository>;
  let apiKeyService: ApiKeyService;

  beforeEach(() => {
    mockRepository = {
      createUser: jest.fn(),
      findUserByEmail: jest.fn(),
      findUserById: jest.fn(),
      updateLastLogin: jest.fn(),
      createApiKey: jest.fn(),
      findApiKeyByHash: jest.fn(),
      findApiKeyById: jest.fn(),
      listApiKeysByUser: jest.fn(),
      revokeApiKey: jest.fn(),
      touchApiKeyLastUsed: jest.fn(),
      addAuditLog: jest.fn(),
    } as unknown as jest.Mocked<AuthRepository>;

    apiKeyService = new ApiKeyService(mockRepository);
  });

  it('should generate prefixed rawKey and hash stored in DB', async () => {
    mockRepository.findUserById.mockResolvedValue({
      id: 'usr-1',
      email: 'user@flux.com',
      passwordHash: 'hash',
      role: 'OPERATOR',
      enabled: true,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockRepository.createApiKey.mockImplementation((data) =>
      Promise.resolve({
        id: 'key-1',
        userId: data.userId,
        name: data.name,
        keyPrefix: data.keyPrefix,
        keyHash: data.keyHash,
        scopes: data.scopes,
        enabled: true,
        lastUsedAt: null,
        expiresAt: null,
        createdAt: new Date(),
        revokedAt: null,
      }),
    );

    const result = await apiKeyService.createApiKey({ userId: 'usr-1', name: 'Test Key' });

    expect(result.rawKey.startsWith('flux_live_')).toBe(true);
    expect(result.apiKey.keyHash).not.toEqual(result.rawKey);
  });

  it('should verify valid raw key', async () => {
    const rawKey = 'flux_live_1234567890abcdef1234567890abcdef';
    const keyHash = apiKeyService.hashKey(rawKey);

    mockRepository.findApiKeyByHash.mockResolvedValue({
      id: 'key-1',
      userId: 'usr-1',
      name: 'Test Key',
      keyPrefix: 'flux_live_',
      keyHash,
      scopes: ['jobs:write'],
      enabled: true,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      revokedAt: null,
    });

    mockRepository.findUserById.mockResolvedValue({
      id: 'usr-1',
      email: 'user@flux.com',
      passwordHash: 'hash',
      role: 'OPERATOR',
      enabled: true,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ctx = await apiKeyService.verifyApiKey(rawKey);
    expect(ctx.userId).toBe('usr-1');
    expect(ctx.authType).toBe('API_KEY');
    expect(ctx.scopes).toContain('jobs:write');
  });

  it('should reject revoked key', async () => {
    const rawKey = 'flux_live_revoked';
    const keyHash = apiKeyService.hashKey(rawKey);

    mockRepository.findApiKeyByHash.mockResolvedValue({
      id: 'key-1',
      userId: 'usr-1',
      name: 'Test Key',
      keyPrefix: 'flux_live_',
      keyHash,
      scopes: ['jobs:write'],
      enabled: false,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      revokedAt: new Date(),
    });

    await expect(apiKeyService.verifyApiKey(rawKey)).rejects.toThrow(InvalidApiKeyError);
  });
});
