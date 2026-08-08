import { AuthService } from '../../src/auth/auth.service.js';
import { AuthRepository } from '../../src/auth/auth.repository.js';
import { InvalidCredentialsError } from '../../src/auth/auth.errors.js';

describe('AuthService', () => {
  let mockRepository: jest.Mocked<AuthRepository>;
  let authService: AuthService;

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

    authService = new AuthService(mockRepository);
  });

  describe('Password Hashing', () => {
    it('should hash password and verify successfully', async () => {
      const hash = await authService.hashPassword('secret123');
      expect(hash).not.toEqual('secret123');

      const isValid = await authService.verifyPassword('secret123', hash);
      expect(isValid).toBe(true);

      const isInvalid = await authService.verifyPassword('wrongpassword', hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe('authenticateUser', () => {
    it('should authenticate user and generate JWT token', async () => {
      const passwordHash = await authService.hashPassword('secret123');
      mockRepository.findUserByEmail.mockResolvedValue({
        id: 'usr-1',
        email: 'op@flux.internal',
        passwordHash,
        role: 'OPERATOR',
        enabled: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await authService.authenticateUser('op@flux.internal', 'secret123');
      expect(result.user.id).toBe('usr-1');
      expect(result.accessToken).toBeDefined();

      const decoded = authService.verifyAccessToken(result.accessToken);
      expect(decoded.userId).toBe('usr-1');
      expect(decoded.role).toBe('OPERATOR');
      expect(decoded.scopes).toContain('jobs:write');
    });

    it('should throw InvalidCredentialsError for wrong password', async () => {
      const passwordHash = await authService.hashPassword('secret123');
      mockRepository.findUserByEmail.mockResolvedValue({
        id: 'usr-1',
        email: 'op@flux.internal',
        passwordHash,
        role: 'OPERATOR',
        enabled: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(authService.authenticateUser('op@flux.internal', 'wrongpass')).rejects.toThrow(
        InvalidCredentialsError,
      );
    });

    it('should throw InvalidCredentialsError for non-existent user', async () => {
      mockRepository.findUserByEmail.mockResolvedValue(null);

      await expect(
        authService.authenticateUser('unknown@flux.internal', 'secret123'),
      ).rejects.toThrow(InvalidCredentialsError);
    });
  });
});
