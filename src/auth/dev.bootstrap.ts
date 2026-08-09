import { authRepository } from './auth.repository.js';
import { authService } from './auth.service.js';
import { env } from '../config/env.js';
import { appLogger, errorLogger } from '../logger/logger.js';

export const bootstrapDevUser = async (): Promise<void> => {
  // Only execute bootstrap when in development mode or explicitly enabled
  if (env.NODE_ENV === 'production') {
    return;
  }

  const devEmail = 'admin@flux.local';
  const devPassword = 'FluxDev123!';
  const devRole = 'ADMIN';

  try {
    const passwordHash = await authService.hashPassword(devPassword);
    const user = await authRepository.upsertUser({
      email: devEmail,
      passwordHash,
      role: devRole,
    });

    appLogger.info('Development bootstrap admin user ready', {
      userId: user.id,
      email: user.email,
      role: user.role,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errorLogger.error('Failed to bootstrap development user', { error: errorMsg });
  }
};
