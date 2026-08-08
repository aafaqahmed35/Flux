import { Router, Request, Response, NextFunction } from 'express';
import { authController } from '../auth/auth.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';
import { createRateLimitMiddleware } from '../security/rate-limit/rate-limit.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

const loginRateLimit = createRateLimitMiddleware('login', 10, 60);

router.post(
  '/login',
  loginRateLimit,
  asyncHandler((req: Request, res: Response, next: NextFunction) =>
    authController.login(req, res, next),
  ),
);

router.post(
  '/api-keys',
  authMiddleware,
  asyncHandler((req: Request, res: Response, next: NextFunction) =>
    authController.createApiKey(req, res, next),
  ),
);

router.get(
  '/api-keys',
  authMiddleware,
  asyncHandler((req: Request, res: Response, next: NextFunction) =>
    authController.listApiKeys(req, res, next),
  ),
);

router.delete(
  '/api-keys/:id',
  authMiddleware,
  asyncHandler((req: Request, res: Response, next: NextFunction) =>
    authController.revokeApiKey(req, res, next),
  ),
);

router.post(
  '/api-keys/:id/rotate',
  authMiddleware,
  asyncHandler((req: Request, res: Response, next: NextFunction) =>
    authController.rotateApiKey(req, res, next),
  ),
);

export const authRouter = router;
export default router;
