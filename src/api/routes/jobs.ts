/**
 * Jobs REST API routes.
 *
 * Base path: /api/v1/jobs
 *
 * Endpoints:
 *   POST   /                     Submit a new job
 *   GET    /                     List jobs (filtered, paginated)
 *   GET    /stats                Aggregate job statistics
 *   GET    /:id                  Get a single job
 *   GET    /:id/history          Get execution history for a job
 *   PATCH  /:id/cancel           Cancel a pending/running job
 *   POST   /:id/retry            Manually retry a failed job
 *   POST   /bulk/cancel          Bulk cancel jobs
 *   GET    /dlq                  List dead letter queue entries
 *   POST   /dlq/:dlqId/replay    Replay a specific DLQ entry
 *   POST   /dlq/replay-all       Replay all DLQ entries
 */

import { Router, Request, Response } from 'express';
import { jobService } from '../../services/JobService';
import { retryService } from '../../services/RetryService';
import { authenticate } from '../middleware/auth';
import { validate, jobSchemas } from '../middleware/validation';
import { apiRateLimit, bulkRateLimit } from '../middleware/rateLimit';
import { CreateJobDto } from '../../models/Job';

const router = Router();

// ─── POST /jobs ───────────────────────────────────────────────────────────────
router.post(
  '/',
  apiRateLimit,
  authenticate(['jobs:write']),
  validate({ body: jobSchemas.create }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dto: CreateJobDto = {
        ...req.body,
        organizationId: req.user!.organizationId,
        createdBy: req.user!.userId,
      };
      const job = await jobService.createJob(dto);
      res.status(201).json({ data: job });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── GET /jobs ────────────────────────────────────────────────────────────────
router.get(
  '/',
  apiRateLimit,
  authenticate(['jobs:read']),
  validate({ query: jobSchemas.list }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const filter = {
        ...req.query,
        organizationId: req.user!.organizationId,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
      };
      const result = await jobService.listJobs(filter as Parameters<typeof jobService.listJobs>[0]);
      res.json({
        data: result.data,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── GET /jobs/stats ──────────────────────────────────────────────────────────
router.get(
  '/stats',
  apiRateLimit,
  authenticate(['jobs:read']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const stats = await jobService.getJobStats(req.user!.organizationId);
      res.json({ data: stats });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── GET /jobs/dlq ────────────────────────────────────────────────────────────
router.get(
  '/dlq',
  apiRateLimit,
  authenticate(['jobs:read']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const summary = await retryService.getDLQSummary();
      res.json({ data: summary });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── POST /jobs/dlq/replay-all ────────────────────────────────────────────────
router.post(
  '/dlq/replay-all',
  bulkRateLimit,
  authenticate(['jobs:write']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const replayed = await retryService.replayAllDLQ();
      res.json({ data: { replayed } });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── POST /jobs/dlq/:dlqId/replay ─────────────────────────────────────────────
router.post(
  '/dlq/:dlqId/replay',
  apiRateLimit,
  authenticate(['jobs:write']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      await retryService.replayDLQEntry(req.params.dlqId);
      res.json({ data: { replayed: true } });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── POST /jobs/bulk/cancel ───────────────────────────────────────────────────
router.post(
  '/bulk/cancel',
  bulkRateLimit,
  authenticate(['jobs:write']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(422).json({ error: 'ids must be a non-empty array' });
        return;
      }
      if (ids.length > 100) {
        res.status(422).json({ error: 'Maximum 100 IDs per bulk operation' });
        return;
      }
      const result = await jobService.bulkCancel(ids, req.user!.organizationId);
      res.json({ data: result });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── GET /jobs/:id ────────────────────────────────────────────────────────────
router.get(
  '/:id',
  apiRateLimit,
  authenticate(['jobs:read']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const job = await jobService.getJob(req.params.id, req.user!.organizationId);
      res.json({ data: job });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── GET /jobs/:id/history ────────────────────────────────────────────────────
router.get(
  '/:id/history',
  apiRateLimit,
  authenticate(['jobs:read']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const history = await jobService.getJobHistory(req.params.id, req.user!.organizationId);
      res.json({ data: history });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── PATCH /jobs/:id/cancel ───────────────────────────────────────────────────
router.patch(
  '/:id/cancel',
  apiRateLimit,
  authenticate(['jobs:write']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const job = await jobService.cancelJob(req.params.id, req.user!.organizationId);
      res.json({ data: job });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── POST /jobs/:id/retry ─────────────────────────────────────────────────────
router.post(
  '/:id/retry',
  apiRateLimit,
  authenticate(['jobs:write']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const job = await jobService.retryJob(req.params.id, req.user!.organizationId);
      res.json({ data: job });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ─── Error handler ────────────────────────────────────────────────────────────
function handleError(err: unknown, res: Response): void {
  const error = err as Error & { statusCode?: number };
  const statusCode = error.statusCode ?? 500;
  const message = statusCode < 500 ? error.message : 'Internal server error';
  if (statusCode >= 500) console.error(err);
  res.status(statusCode).json({ error: message });
}

export default router;
