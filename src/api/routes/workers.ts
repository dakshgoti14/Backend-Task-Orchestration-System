/**
 * Workers REST API routes.
 * Base path: /api/v1/workers
 */

import { Router, Request, Response } from 'express';
import { workerService } from '../../services/WorkerService';
import { authenticate } from '../middleware/auth';
import { apiRateLimit } from '../middleware/rateLimit';

const router = Router();

router.get('/', apiRateLimit, authenticate(['workers:read']), async (req: Request, res: Response): Promise<void> => {
  try {
    const workers = await workerService.listWorkers();
    res.json({ data: workers });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/metrics', apiRateLimit, authenticate(['workers:read']), async (req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await workerService.getWorkerMetrics();
    res.json({ data: metrics });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', apiRateLimit, authenticate(['workers:read']), async (req: Request, res: Response): Promise<void> => {
  try {
    const worker = await workerService.getWorker(req.params.id);
    res.json({ data: worker });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ error: error.message });
  }
});

export default router;
