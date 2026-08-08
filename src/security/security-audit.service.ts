import { authRepository, AuthRepository } from '../auth/auth.repository.js';
import { SecurityAuditLogEntry } from '../auth/auth.types.js';
import { appLogger, errorLogger } from '../logger/logger.js';

export class SecurityAuditService {
  private readonly repository: AuthRepository;

  constructor(repository: AuthRepository = authRepository) {
    this.repository = repository;
  }

  async logEvent(entry: SecurityAuditLogEntry): Promise<void> {
    try {
      // Exclude passwords or secrets from metadata
      const sanitizedMetadata = { ...entry.metadata };
      delete sanitizedMetadata['password'];
      delete sanitizedMetadata['secret'];
      delete sanitizedMetadata['authorization'];

      await this.repository.addAuditLog({
        ...entry,
        metadata: sanitizedMetadata,
      });

      appLogger.info('Security Audit Event Logged', {
        action: entry.action,
        userId: entry.userId,
        resourceType: entry.resourceType,
      });
    } catch (err: unknown) {
      errorLogger.error('Failed to log security audit event', { error: String(err) });
    }
  }
}

export const securityAuditService = new SecurityAuditService();
