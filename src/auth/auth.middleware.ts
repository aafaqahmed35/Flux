import { Response, NextFunction } from 'express';
import { AUTH_HEADERS, isAuthEnabled } from './auth.constants.js';
import { AuthenticationRequiredError, InvalidCredentialsError } from './auth.errors.js';
import { apiKeyService } from './api-key.service.js';
import { authService } from './auth.service.js';
import { AuthenticatedRequest, AuthContext } from './auth.types.js';

export const authMiddleware = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void => {
  if (!isAuthEnabled()) {
    req.authContext = {
      userId: 'dev-admin',
      email: 'admin@flux.internal',
      role: 'ADMIN',
      scopes: ['admin:*'],
      authType: 'JWT',
    };
    next();
    return;
  }

  void (async (): Promise<void> => {
    const authHeader = req.headers[AUTH_HEADERS.AUTHORIZATION] || req.headers['Authorization'];
    const apiKeyHeader = req.headers[AUTH_HEADERS.API_KEY] || req.headers['X-API-Key'];

    try {
      let authContext: AuthContext | null = null;

      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        authContext = authService.verifyAccessToken(token);
      } else if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim().length > 0) {
        authContext = await apiKeyService.verifyApiKey(apiKeyHeader.trim());
      }

      if (!authContext) {
        throw new AuthenticationRequiredError();
      }

      req.authContext = authContext;
      next();
    } catch (err: unknown) {
      if (err instanceof AuthenticationRequiredError || err instanceof InvalidCredentialsError) {
        next(err);
      } else if (err instanceof Error) {
        next(err);
      } else {
        next(new InvalidCredentialsError('Authentication failed'));
      }
    }
  })();
};
