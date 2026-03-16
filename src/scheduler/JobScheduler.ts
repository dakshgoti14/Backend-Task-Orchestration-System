/**
 * JobScheduler — the central orchestration engine.
 *
 * Responsibilities:
 *  1. Poll PostgreSQL for PENDING jobs that are ready to execute
 *  2. Enqueue them into BullMQ with correct priority + delay
 *  3. Drive the CronScheduler for recurring jobs
 *  4. Coordinate with DependencyResolver to unblock waiting jobs
 *  5. Detect and recover stalled jobs (worker crash scenarios)
 *  6. Maintain leader-only execution via distributed lock
 *
 * Only one scheduler instance (the leader) actively schedules.
 * Followers monitor for leader failure and take over via LeaderElection.
 */

import EventEmitter from 'eventemitter3';
import { jobRepository } from '../db/repositories/JobRepository';
import { jobQueue } from '../queue/JobQueue';
import { CronScheduler } from './CronScheduler';
import { DependencyResolver } from './DependencyResolver';
import { LoadBalancer } from './LoadBalancer';
import { distributedLock } from '../distributed/DistributedLock';
import { createLogger } from '../utils/logger';
import { config } from '../utils/config';
import { Job, CreateJobDto, JobStatus } from '../models/Job';
import { metricsService } from '../monitoring/MetricsService';
import { sleep } from '../utils/helpers';

const log = createLogger('JobScheduler');

export interface SchedulerConfig {
  pollIntervalMs: number;
  batchSize: number;
  stalledJobThresholdMs: number;
  lockTtlMs: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  pollIntervalMs: config.scheduler.pollIntervalMs,
  batchSize: 50,
  stalledJobThresholdMs: 2 * 60_000, // 2 minutes
  lockTtlMs: config.scheduler.lockTtlMs,
};

export class JobScheduler extends EventEmitter {
  private schedulerConfig: SchedulerConfig;
  private cronScheduler: CronScheduler;
  private depResolver: DependencyResolver;
  private loadBalancer: LoadBalancer;
  private isRunning = false;
  private isLeader = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private lockRenewalInterval: NodeJS.Timeout | null = null;

  constructor(cfg: Partial<SchedulerConfig> = {}) {
    super();
    this.schedulerConfig = { ...DEFAULT_CONFIG, ...cfg };
    this.depResolver = new DependencyResolver();
    this.loadBalancer = new LoadBalancer('LEAST_LOADED');
    this.cronScheduler = new CronScheduler((dto) => this.submitJob(dto));

    this.depResolver.on('jobs:unblocked', (jobIds: string[]) => {
      log.info('Dependencies resolved, jobs unblocked', { count: jobIds.length, jobIds });
      this.emit('jobs:unblocked', jobIds);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    log.info('JobScheduler starting', { config: this.schedulerConfig });

    // Attempt to acquire leader lock; if acquired, start active scheduling
    await this.tryBecomeLeader();
    this.schedulePoll();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    if (this.lockRenewalInterval) clearInterval(this.lockRenewalInterval);
    this.cronScheduler.stop();
    log.info('JobScheduler stopped');
    this.emit('stopped');
  }

  private async tryBecomeLeader(): Promise<void> {
    try {
      const acquired = await distributedLock.tryAcquire(
        'scheduler:leader',
        this.schedulerConfig.lockTtlMs,
      );

      if (acquired) {
        this.isLeader = true;
        log.info('Acquired leader lock — starting active scheduling');
        this.cronScheduler.start(this.schedulerConfig.pollIntervalMs);
        this.startLockRenewal();
        this.emit('leader:acquired');
      } else {
        log.info('Did not acquire leader lock — running as follower');
        this.emit('leader:follower');
      }
    } catch (err) {
      log.warn('Leader election failed (Redis unavailable?), running standalone', { error: err });
      this.isLeader = true; // fallback: run without distributed lock
      this.cronScheduler.start(this.schedulerConfig.pollIntervalMs);
    }
  }

  private startLockRenewal(): void {
    const renewalMs = Math.floor(this.schedulerConfig.lockTtlMs * 0.6);
    this.lockRenewalInterval = setInterval(async () => {
      try {
        const renewed = await distributedLock.renew(
          'scheduler:leader',
          this.schedulerConfig.lockTtlMs,
        );
        if (!renewed) {
          log.warn('Failed to renew leader lock — stepping down');
          this.isLeader = false;
          this.cronScheduler.stop();
          clearInterval(this.lockRenewalInterval!);
          this.emit('leader:lost');
          // Try to re-acquire after a backoff
          await sleep(2000);
          await this.tryBecomeLeader();
        }
      } catch (err) {
        log.error('Lock renewal error', { error: err });
      }
    }, renewalMs);
  }

  private schedulePoll(): void {
    if (!this.isRunning) return;
    this.pollTimeout = setTimeout(async () => {
      if (this.isLeader) {
        await this.poll();
      }
      this.schedulePoll();
    }, this.schedulerConfig.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    try {
      await Promise.all([
        this.scheduleReadyJobs(),
        this.recoverStalledJobs(),
      ]);
    } catch (err) {
      log.error('Scheduler poll error', { error: err });
    }
  }

  /**
   * Core scheduling loop:
   * 1. Claim PENDING jobs from DB (atomic FOR UPDATE SKIP LOCKED)
   * 2. Validate dependency readiness
   * 3. Enqueue into BullMQ with correct priority
   */
  private async scheduleReadyJobs(): Promise<void> {
    const jobs = await jobRepository.claimPendingJobs(this.schedulerConfig.batchSize);
    if (jobs.length === 0) return;

    log.info(`Scheduling ${jobs.length} jobs`);

    const enqueuePromises = jobs.map(async (job) => {
      try {
        // Re-check dependency resolution (the DB query handles this but double-check)
        if (job.dependencyCount > job.resolvedDependencyCount) {
          // Dependencies not met — revert to PENDING
          await jobRepository.update(job.id, { status: 'PENDING' });
          return;
        }

        const delayMs = job.scheduledAt
          ? Math.max(0, job.scheduledAt.getTime() - Date.now())
          : 0;

        await jobQueue.add(
          {
            jobId: job.id,
            type: job.type,
            payload: job.payload,
            organizationId: job.organizationId,
            attemptNumber: job.retryCount + 1,
          },
          {
            priority: job.priority,
            delayMs,
            jobId: `job_${job.id}`,
          },
        );

        log.debug('Job enqueued', { jobId: job.id, type: job.type, priority: job.priority, delayMs });
        this.emit('job:enqueued', job);
      } catch (err) {
        log.error('Failed to enqueue job', { jobId: job.id, error: err });
        // Revert status so it gets picked up in next poll
        await jobRepository.update(job.id, { status: 'PENDING' });
      }
    });

    await Promise.allSettled(enqueuePromises);
  }

  /**
   * Detect jobs stuck in RUNNING state (worker crashed, no heartbeat).
   * Re-queue them for retry or move to DLQ.
   */
  private async recoverStalledJobs(): Promise<void> {
    const stalledJobs = await jobRepository.findStalledJobs(
      this.schedulerConfig.stalledJobThresholdMs,
    );

    if (stalledJobs.length === 0) return;

    log.warn(`Found ${stalledJobs.length} stalled job(s), recovering`);

    for (const job of stalledJobs) {
      if (job.retryCount < job.maxRetries) {
        await jobRepository.update(job.id, {
          status: 'PENDING',
          workerId: undefined,
          startedAt: undefined,
        });
        log.info('Stalled job requeued for retry', { jobId: job.id, retryCount: job.retryCount + 1 });
      } else {
        await jobRepository.update(job.id, {
          status: 'FAILED',
          errorMessage: 'Job stalled: worker did not complete within timeout',
          completedAt: new Date(),
        });
        log.warn('Stalled job marked as FAILED (exhausted retries)', { jobId: job.id });
        metricsService.recordJobFailed(job.type, job.priority, 'STALLED');
      }
    }
  }

  /**
   * Submit a new job (used by API and CronScheduler).
   */
  async submitJob(dto: CreateJobDto): Promise<Job> {
    const job = await jobRepository.create(dto);
    this.depResolver.register(job);
    log.debug('Job submitted', { jobId: job.id, type: job.type });
    metricsService.recordJobSubmitted(job.type, job.priority, job.organizationId);
    this.emit('job:submitted', job);
    return job;
  }

  /**
   * Called by workers when a job completes — drives dependency resolution.
   */
  async onJobCompleted(jobId: string, status: JobStatus): Promise<void> {
    const unblockedIds = this.depResolver.onJobStateChange(jobId, status);

    if (unblockedIds.length > 0) {
      // Update resolved_dependency_count in DB for each unblocked job
      for (const id of unblockedIds) {
        await jobRepository.resolveDependency(jobId);
      }
    }

    if (status === 'COMPLETED') {
      const job = await jobRepository.findById(jobId);
      if (job) {
        metricsService.recordJobCompleted(
          job.type,
          job.priority,
          job.completedAt && job.startedAt
            ? job.completedAt.getTime() - job.startedAt.getTime()
            : 0,
        );
      }
    }
  }

  get stats() {
    return {
      isLeader: this.isLeader,
      isRunning: this.isRunning,
      dependencyGraphStats: this.depResolver.getStats(),
    };
  }
}

export const jobScheduler = new JobScheduler();
