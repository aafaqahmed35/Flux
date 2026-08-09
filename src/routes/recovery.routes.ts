import { Router } from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireScope } from '../auth/authorize.middleware.js';
import { recoveryController } from '../controllers/recovery.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/status', requireScope('recovery:read'), recoveryController.getStatus);
router.get('/stale', requireScope('recovery:read'), recoveryController.getStaleJobs);
router.post('/run', requireScope('recovery:write'), recoveryController.runRecovery);

export const recoveryRouter = router;
export default router;
