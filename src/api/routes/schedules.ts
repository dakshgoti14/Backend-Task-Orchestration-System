/**
 * Schedules REST API routes.
 * Base path: /api/v1/schedules
 */

import { Router, Request, Response } from 'express';
import { db, TABLES } from '../../db/index';
import { authenticate } from '../middleware/auth';
import { validate, scheduleSchemas } from '../middleware/validation';
import { apiRateLimit } from '../middleware/rateLimit';
import { CronScheduler } from '../../scheduler/CronScheduler';
import { generateId } from '../../utils/helpers';

const router = Router();

router.get('/', apiRateLimit, authenticate(['jobs:read']), async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db(TABLES.SCHEDULES)
      .where({ organization_id: req.user!.organizationId })
      .orderBy('created_at', 'desc')
      .select('*');
    res.json({ data: rows });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', apiRateLimit, authenticate(['jobs:write']), validate({ body: scheduleSchemas.create }), async (req: Request, res: Response): Promise<void> => {
  try {
    const tz = req.body.timezone ?? 'UTC';
    // Validate cron expression
    const nextTrigger = CronScheduler.computeNextTrigger(req.body.cronExpression, tz);

    const row = {
      id: generateId(),
      name: req.body.name,
      description: req.body.description,
      cron_expression: req.body.cronExpression,
      timezone: tz,
      job_template: JSON.stringify(req.body.jobTemplate),
      is_active: true,
      next_trigger_at: nextTrigger,
      total_triggered_count: 0,
      organization_id: req.user!.organizationId,
      created_by: req.user!.userId,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const [inserted] = await db(TABLES.SCHEDULES).insert(row).returning('*');
    res.status(201).json({ data: inserted });
  } catch (err) {
    const error = err as Error;
    res.status(422).json({ error: error.message });
  }
});

router.patch('/:id/pause', apiRateLimit, authenticate(['jobs:write']), async (req: Request, res: Response): Promise<void> => {
  try {
    await db(TABLES.SCHEDULES)
      .where({ id: req.params.id, organization_id: req.user!.organizationId })
      .update({ is_active: false, updated_at: new Date() });
    res.json({ data: { paused: true } });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/resume', apiRateLimit, authenticate(['jobs:write']), async (req: Request, res: Response): Promise<void> => {
  try {
    const [row] = await db(TABLES.SCHEDULES)
      .where({ id: req.params.id, organization_id: req.user!.organizationId })
      .first()
      .returning('*');

    if (!row) { res.status(404).json({ error: 'Schedule not found' }); return; }
    const nextTrigger = CronScheduler.computeNextTrigger(row.cron_expression, row.timezone);

    await db(TABLES.SCHEDULES)
      .where({ id: req.params.id })
      .update({ is_active: true, next_trigger_at: nextTrigger, updated_at: new Date() });

    res.json({ data: { resumed: true, nextTriggerAt: nextTrigger } });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', apiRateLimit, authenticate(['jobs:write']), async (req: Request, res: Response): Promise<void> => {
  try {
    await db(TABLES.SCHEDULES)
      .where({ id: req.params.id, organization_id: req.user!.organizationId })
      .delete();
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
