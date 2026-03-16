/**
 * JobService — business logic layer for job management.
 *
 * Coordinates between:
 *  - JobRepository (persistence)
 *  - JobScheduler (enqueuing and lifecycle events)
 *  - ExecutionRepository (history)
 *  - NotificationService (alerts)
 *
 * This is the single point of contact for the API layer.
 * All validation and authorization checks happen here.
 */

import { jobRepository } from '../db/repositories/JobRepository';
import { executionRepository } from '../db/repositories/ExecutionRepository';
import { jobScheduler } from '../scheduler/JobScheduler';
import { createLogger } from '../utils/logger';
import {
  Job,
  CreateJobDto,
  UpdateJobDto,
  JobFilter,
  PaginatedJobs,
  JobStatus,
} from '../models/Job';
import { ExecutionLog } from '../models/ExecutionLog';

const log = createLogger('JobService');

export class JobService {
  /**
   * Submit a new job. Validates input, creates DB record, and triggers scheduling.
   */
  async createJob(dto: CreateJobDto): Promise<Job> {
    // Validate cron expression if provided
    if (dto.cronExpression) {
      const { CronScheduler } = await import('../scheduler/CronScheduler');
      CronScheduler.computeNextTrigger(dto.cronExpression, dto.timezone ?? 'UTC');
    }

    // Validate dependencies reference real jobs
    if (dto.dependencies && dto.dependencies.length > 0) {
      for (const dep of dto.dependencies) {
        const depJob = await jobRepository.findById(dep.jobId);
        if (!depJob) throw new Error(`Dependency job not found: ${dep.jobId}`);
      }
    }

    const job = await jobScheduler.submitJob(dto);
    log.info('Job created', { jobId: job.id, type: job.type, priority: job.priority });
    return job;
  }

  async getJob(id: string, organizationId: string): Promise<Job> {
    const job = await jobRepository.findById(id);
    if (!job) throw new NotFoundError(`Job not found: ${id}`);
    if (job.organizationId !== organizationId) throw new ForbiddenError('Access denied');
    return job;
  }

  async listJobs(filter: JobFilter): Promise<PaginatedJobs> {
    return jobRepository.findMany(filter);
  }

  async cancelJob(id: string, organizationId: string): Promise<Job> {
    const job = await this.getJob(id, organizationId);

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      throw new ConflictError(`Cannot cancel job in status: ${job.status}`);
    }

    const updated = await jobRepository.update(id, {
      status: 'CANCELLED',
      completedAt: new Date(),
    });

    if (!updated) throw new Error('Failed to cancel job');

    log.info('Job cancelled', { jobId: id });
    return updated;
  }

  async retryJob(id: string, organizationId: string): Promise<Job> {
    const job = await this.getJob(id, organizationId);

    if (!['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(job.status)) {
      throw new ConflictError(`Cannot retry job in status: ${job.status}`);
    }

    // Reset job to PENDING and let the scheduler pick it up
    const updated = await jobRepository.update(id, {
      status: 'PENDING',
      workerId: undefined,
      startedAt: undefined,
      completedAt: undefined,
      errorMessage: undefined,
      errorStack: undefined,
    });

    if (!updated) throw new Error('Failed to retry job');

    log.info('Job queued for retry', { jobId: id });
    return updated;
  }

  async getJobHistory(id: string, organizationId: string): Promise<ExecutionLog[]> {
    await this.getJob(id, organizationId); // authorization check
    return executionRepository.findByJobId(id);
  }

  async bulkCancel(
    ids: string[],
    organizationId: string,
  ): Promise<{ cancelled: string[]; skipped: string[] }> {
    const cancelled: string[] = [];
    const skipped: string[] = [];

    for (const id of ids) {
      try {
        await this.cancelJob(id, organizationId);
        cancelled.push(id);
      } catch {
        skipped.push(id);
      }
    }
    return { cancelled, skipped };
  }

  async getJobStats(organizationId: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    avgDurationMs: number;
  }> {
    const [pending, queued, running, completed, failed, retrying, cancelled] =
      await Promise.all([
        jobRepository.findMany({ organizationId, status: 'PENDING', limit: 1 }),
        jobRepository.findMany({ organizationId, status: 'QUEUED', limit: 1 }),
        jobRepository.findMany({ organizationId, status: 'RUNNING', limit: 1 }),
        jobRepository.findMany({ organizationId, status: 'COMPLETED', limit: 1 }),
        jobRepository.findMany({ organizationId, status: 'FAILED', limit: 1 }),
        jobRepository.findMany({ organizationId, status: 'RETRYING', limit: 1 }),
        jobRepository.findMany({ organizationId, status: 'CANCELLED', limit: 1 }),
      ]);

    const total =
      pending.total + queued.total + running.total +
      completed.total + failed.total + retrying.total + cancelled.total;

    return {
      total,
      byStatus: {
        PENDING: pending.total,
        QUEUED: queued.total,
        RUNNING: running.total,
        COMPLETED: completed.total,
        FAILED: failed.total,
        RETRYING: retrying.total,
        CANCELLED: cancelled.total,
      },
      byPriority: {},
      avgDurationMs: 0,
    };
  }
}

// ─── Error types ────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(msg: string) { super(msg); this.name = 'NotFoundError'; }
}

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(msg: string) { super(msg); this.name = 'ForbiddenError'; }
}

export class ConflictError extends Error {
  statusCode = 409;
  constructor(msg: string) { super(msg); this.name = 'ConflictError'; }
}

export class ValidationError extends Error {
  statusCode = 422;
  constructor(msg: string) { super(msg); this.name = 'ValidationError'; }
}

export const jobService = new JobService();
