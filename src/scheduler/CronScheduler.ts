/**
 * CronScheduler — manages recurring job schedules using cron expressions.
 *
 * On each poll tick, it:
 *  1. Fetches schedules whose next_trigger_at <= NOW()
 *  2. Creates a new Job record from the schedule's job template
 *  3. Advances next_trigger_at to the following cron occurrence
 *  4. Handles timezone-aware scheduling via cron-parser
 *
 * Distributed safety: only the LEADER node runs the cron scheduler.
 * The distributed lock (DistributedLock) ensures exactly-once triggering.
 */

import { db, TABLES } from '../db/index';
import { getNextCronRun, generateId } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { Schedule } from '../models/ExecutionLog';
import { CreateJobDto } from '../models/Job';

const log = createLogger('CronScheduler');

export class CronScheduler {
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private onTrigger: (dto: CreateJobDto) => Promise<void>;

  constructor(onTrigger: (dto: CreateJobDto) => Promise<void>) {
    this.onTrigger = onTrigger;
  }

  start(pollIntervalMs: number = 5000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollInterval = setInterval(() => this.tick(), pollIntervalMs);
    log.info('CronScheduler started', { pollIntervalMs });
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    log.info('CronScheduler stopped');
  }

  private async tick(): Promise<void> {
    try {
      const dueSchedules = await this.fetchDueSchedules();
      if (dueSchedules.length === 0) return;

      log.info(`Processing ${dueSchedules.length} due cron schedule(s)`);

      for (const schedule of dueSchedules) {
        await this.triggerSchedule(schedule);
      }
    } catch (err) {
      log.error('CronScheduler tick error', { error: err });
    }
  }

  private async fetchDueSchedules(): Promise<Schedule[]> {
    const rows = await db(TABLES.SCHEDULES)
      .where('is_active', true)
      .where('next_trigger_at', '<=', new Date())
      .forUpdate()
      .skipLocked()
      .select('*');

    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      description: r.description as string | undefined,
      cronExpression: r.cron_expression as string,
      timezone: r.timezone as string,
      jobTemplate: r.job_template as Schedule['jobTemplate'],
      isActive: r.is_active as boolean,
      lastTriggeredAt: r.last_triggered_at ? new Date(r.last_triggered_at as string) : undefined,
      nextTriggerAt: r.next_trigger_at ? new Date(r.next_trigger_at as string) : undefined,
      totalTriggeredCount: r.total_triggered_count as number,
      organizationId: r.organization_id as string,
      createdBy: r.created_by as string,
      createdAt: new Date(r.created_at as string),
      updatedAt: new Date(r.updated_at as string),
    }));
  }

  private async triggerSchedule(schedule: Schedule): Promise<void> {
    const nextRun = getNextCronRun(schedule.cronExpression, schedule.timezone);

    // Advance the schedule's next_trigger_at BEFORE creating the job to
    // prevent duplicate triggers if job creation fails.
    await db(TABLES.SCHEDULES).where({ id: schedule.id }).update({
      last_triggered_at: new Date(),
      next_trigger_at: nextRun,
      total_triggered_count: db.raw('total_triggered_count + 1'),
      updated_at: new Date(),
    });

    const jobDto: CreateJobDto = {
      name: `${schedule.name} [cron:${new Date().toISOString()}]`,
      description: schedule.description,
      type: schedule.jobTemplate.type as CreateJobDto['type'],
      payload: schedule.jobTemplate.payload,
      priority: schedule.jobTemplate.priority as CreateJobDto['priority'],
      timeoutMs: schedule.jobTemplate.timeoutMs,
      retryConfig: schedule.jobTemplate.retryConfig as CreateJobDto['retryConfig'],
      tags: [...(schedule.jobTemplate.tags ?? []), 'cron', `schedule:${schedule.id}`],
      organizationId: schedule.organizationId,
      createdBy: schedule.createdBy,
      metadata: { scheduleId: schedule.id, triggeredAt: new Date().toISOString() },
    };

    await this.onTrigger(jobDto);

    log.info('Cron schedule triggered', {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      nextRunAt: nextRun.toISOString(),
    });
  }

  /**
   * Calculate and persist next_trigger_at when a schedule is first created/updated.
   */
  static computeNextTrigger(cronExpression: string, timezone: string): Date {
    return getNextCronRun(cronExpression, timezone);
  }
}
