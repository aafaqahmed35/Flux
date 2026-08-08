import { Response, NextFunction } from 'express';
import { apiKeyService } from './api-key.service.js';
import { authService } from './auth.service.js';
import { ApiKeyScope, AuthenticatedRequest } from './auth.types.js';
import { HTTP_STATUS } from '../constants/statusCodes.js';

export class AuthController {
  public login = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email || !password) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Email and password are required' },
        });
        return;
      }

      const result = await authService.authenticateUser(email, password);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            role: result.user.role,
          },
          accessToken: result.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public createApiKey = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authContext?.userId;
      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
        return;
      }

      const { name, scopes, expiresAt } = req.body as {
        name?: string;
        scopes?: ApiKeyScope[];
        expiresAt?: string;
      };

      if (!name) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'API key name is required' },
        });
        return;
      }

      const result = await apiKeyService.createApiKey({
        userId,
        name,
        scopes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message:
          'API key created successfully. Store this secret key now as it cannot be shown again.',
        data: {
          id: result.apiKey.id,
          name: result.apiKey.name,
          keyPrefix: result.apiKey.keyPrefix,
          rawKey: result.rawKey,
          scopes: result.apiKey.scopes,
          createdAt: result.apiKey.createdAt,
          expiresAt: result.apiKey.expiresAt,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public listApiKeys = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authContext?.userId;
      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
        return;
      }

      const keys = await apiKeyService.listApiKeys(userId);

      const sanitizedKeys = keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        enabled: k.enabled,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
      }));

      res.status(HTTP_STATUS.OK).json({
        success: true,
        data: sanitizedKeys,
      });
    } catch (err) {
      next(err);
    }
  };

  public revokeApiKey = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authContext?.userId;
      const { id } = req.params;

      if (!userId || !id) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Invalid key ID' },
        });
        return;
      }

      const revoked = await apiKeyService.revokeApiKey(id, userId);
      if (!revoked) {
        res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'API key not found or already revoked' },
        });
        return;
      }

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'API key revoked successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  public rotateApiKey = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authContext?.userId;
      const { id } = req.params;

      if (!userId || !id) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Invalid key ID' },
        });
        return;
      }

      const result = await apiKeyService.rotateApiKey(id, userId);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'API key rotated successfully',
        data: {
          id: result.apiKey.id,
          name: result.apiKey.name,
          keyPrefix: result.apiKey.keyPrefix,
          rawKey: result.rawKey,
          scopes: result.apiKey.scopes,
          createdAt: result.apiKey.createdAt,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

export const authController = new AuthController();
