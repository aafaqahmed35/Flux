import { Router } from 'express';
import { getHealth, getLiveness, getReadiness } from '../controllers/health.controller.js';

const router = Router();

router.get('/', getHealth);
router.get('/live', getLiveness);
router.get('/ready', getReadiness);

export const healthRoutes = router;
export default router;
