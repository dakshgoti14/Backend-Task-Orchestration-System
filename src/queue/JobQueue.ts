/**
 * JobQueue — BullMQ-backed Redis queue abstraction.
 *
 * Provides:
 *  - Typed job addition with priority and delay support
 *  - Queue inspection (counts, pausing, draining)
 *  - Event hooks (completed, failed, stalled)
 *
 * Architecture note: BullMQ stores job metadata in Redis sorted sets.
 * Priority is modelled as a separate queue per-priority OR via BullMQ's
 * native priority field (lower int = higher priority, so we invert weights).
 */

import {
  Queue,
  QueueEvents,
  Job as BullJob,
  JobsOptions,
  QueueOptions,
} from 'bullmq';
import { config } from '../utils/config';
import { createLogger } from '../utils/logger';
import { PRIORITY_WEIGHT, JobPriority } from '../models/Job';
import { metricsService } from '../monitoring/MetricsService';

const log = createLogger('JobQueue');

export interface QueueJobPayload {
  jobId: string;
  type: string;
  payload: Record<string, unknown>;
  organizationId: string;
  attemptNumber: number;
}

// BullMQ uses lower number = higher priority (0-indexed internally).
// We invert our 5-100 weights into 1-5 BullMQ priorities.
function toBullPriority(p: JobPriority): number {
  const rank = Math.round((100 - PRIORITY_WEIGHT[p]) / 20) + 1; // 1(CRITICAL) – 5(BACKGROUND)
  return rank;
}

const redisConnection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  db: config.redis.db,
  keyPrefix: config.redis.keyPrefix,
  maxRetriesPerRequest: null, // required for BullMQ workers
};

const queueOptions: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: config.worker.maxRetries,
    backoff: {
      type: 'exponential',
      delay: config.worker.retryDelayMs,
    },
    removeOnComplete: {
      age: 24 * 3600,   // keep completed jobs 24 h for dashboard display
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // keep failed jobs 7 days
    },
  },
};

class JobQueueClass {
  private queue: Queue<QueueJobPayload>;
  private queueEvents: QueueEvents;

  constructor() {
    this.queue = new Queue<QueueJobPayload>(config.queue.name, queueOptions);
    this.queueEvents = new QueueEvents(config.queue.name, {
      connection: redisConnection,
    });
    this.attachEventHandlers();
    log.info('JobQueue initialized', { queueName: config.queue.name });
  }

  private attachEventHandlers(): void {
    this.queueEvents.on('completed', ({ jobId }) => {
      log.debug('Bull job completed', { bullJobId: jobId });
      metricsService.recordQueueEvent('completed');
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      log.warn('Bull job failed', { bullJobId: jobId, reason: failedReason });
      metricsService.recordQueueEvent('failed');
    });

    this.queueEvents.on('stalled', ({ jobId }) => {
      log.warn('Bull job stalled (worker crash?)', { bullJobId: jobId });
      metricsService.recordQueueEvent('stalled');
    });

    this.queueEvents.on('error', (err) => {
      log.error('QueueEvents error', { error: err });
    });
  }

  /**
   * Add a job to the queue with optional delay and priority.
   */
  async add(
    payload: QueueJobPayload,
    options: {
      priority?: JobPriority;
      delayMs?: number;
      jobId?: string;
    } = {},
  ): Promise<BullJob<QueueJobPayload>> {
    const jobOptions: JobsOptions = {
      priority: toBullPriority(options.priority ?? 'MEDIUM'),
      delay: options.delayMs ?? 0,
      jobId: options.jobId,
    };

    const bullJob = await this.queue.add(payload.type, payload, jobOptions);
    log.debug('Job added to queue', {
      jobId: payload.jobId,
      bullJobId: bullJob.id,
      priority: options.priority,
      delay: options.delayMs,
    });
    metricsService.recordQueueEvent('added');
    return bullJob;
  }

  /**
   * Add multiple jobs in a single pipeline (more efficient for bulk submission).
   */
  async addBulk(
    jobs: Array<{
      payload: QueueJobPayload;
      priority?: JobPriority;
      delayMs?: number;
    }>,
  ): Promise<void> {
    const bulk = jobs.map(({ payload, priority, delayMs }) => ({
      name: payload.type,
      data: payload,
      opts: {
        priority: toBullPriority(priority ?? 'MEDIUM'),
        delay: delayMs ?? 0,
      },
    }));
    await this.queue.addBulk(bulk);
    metricsService.recordBulkEnqueue(jobs.length);
    log.info('Bulk enqueue complete', { count: jobs.length });
  }

  async pause(): Promise<void> {
    await this.queue.pause();
    log.info('Queue paused');
  }

  async resume(): Promise<void> {
    await this.queue.resume();
    log.info('Queue resumed');
  }

  async drain(): Promise<void> {
    await this.queue.drain();
    log.info('Queue drained');
  }

  async getJobCounts(): Promise<Record<string, number>> {
    return this.queue.getJobCounts(
      'active',
      'waiting',
      'completed',
      'failed',
      'delayed',
      'paused',
    );
  }

  async removeJob(bullJobId: string): Promise<void> {
    const job = await this.queue.getJob(bullJobId);
    if (job) await job.remove();
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.queueEvents.close();
    log.info('JobQueue closed');
  }

  getQueue(): Queue<QueueJobPayload> {
    return this.queue;
  }
}

export const jobQueue = new JobQueueClass();
