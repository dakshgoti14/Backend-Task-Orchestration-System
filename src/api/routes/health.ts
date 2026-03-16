/**
 * Health check endpoints — used by load balancers and Kubernetes probes.
 *
 * GET /health/live    — liveness probe (process is running)
 * GET /health/ready   — readiness probe (DB + Redis are reachable)
 * GET /health         — combined health report
 */

import { Router, Request, Response } from 'express';
import { db } from '../../db/index';
import { queueManager } from '../../queue/QueueManager';
import { jobScheduler } from '../../scheduler/JobScheduler';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('HealthRoute');

router.get('/live', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; error?: string }> = {};
  let allHealthy = true;

  // PostgreSQL check
  const dbStart = Date.now();
  try {
    await db.raw('SELECT 1');
    checks.postgres = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.postgres = { status: 'error', error: (err as Error).message };
    allHealthy = false;
  }

  // Redis / Queue check
  const queueStart = Date.now();
  try {
    const health = await queueManager.getHealth();
    checks.redis = {
      status: health.isHealthy ? 'ok' : 'error',
      latencyMs: Date.now() - queueStart,
    };
    if (!health.isHealthy) allHealthy = false;
  } catch (err) {
    checks.redis = { status: 'error', error: (err as Error).message };
    allHealthy = false;
  }

  const statusCode = allHealthy ? 200 : 503;
  res.status(statusCode).json({
    status: allHealthy ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [queueHealth, schedulerStats] = await Promise.all([
      queueManager.getHealth().catch(() => ({ mainQueue: {}, dlqCount: 0, isHealthy: false })),
      Promise.resolve(jobScheduler.stats),
    ]);

    res.json({
      status: 'ok',
      version: process.env.npm_package_version ?? '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      scheduler: schedulerStats,
      queue: queueHealth,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('Health check error', { error: err });
    res.status(500).json({ status: 'error', error: 'Health check failed' });
  }
});

export default router;
