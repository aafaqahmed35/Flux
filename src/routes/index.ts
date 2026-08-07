import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
import { jobRouter } from './job.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/api/v1/jobs', jobRouter);

export const appRouter = router;
export default router;
