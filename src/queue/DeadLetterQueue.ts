/**
 * Dead Letter Queue (DLQ) — permanently failed jobs land here.
 *
 * After exhausting all retries, jobs are moved to the DLQ for:
 *  - Alerting / notification
 *  - Manual inspection via dashboard
 *  - Controlled replay (re-queue with original payload)
 *
 * Uses a separate BullMQ queue with NO automatic retries.
 */

import { Queue, Job as BullJob } from 'bullmq';
import { config } from '../utils/config';
import { createLogger } from '../utils/logger';
import { metricsService } from '../monitoring/MetricsService';

const log = createLogger('DeadLetterQueue');

export interface DLQEntry {
  originalJobId: string;
  type: string;
  payload: Record<string, unknown>;
  organizationId: string;
  failureReason: string;
  failureStack?: string;
  totalAttempts: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
}

const redisConnection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  db: config.redis.db,
  keyPrefix: config.redis.keyPrefix,
  maxRetriesPerRequest: null,
};

class DeadLetterQueueClass {
  private queue: Queue<DLQEntry>;

  constructor() {
    this.queue = new Queue<DLQEntry>(config.queue.deadLetterQueueName, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 1,       // no automatic retries in DLQ
        removeOnComplete: false, // keep for manual review
        removeOnFail: false,
      },
    });
    log.info('DeadLetterQueue initialized', { queueName: config.queue.deadLetterQueueName });
  }

  async add(entry: DLQEntry): Promise<BullJob<DLQEntry>> {
    const job = await this.queue.add('dlq_entry', entry, {
      jobId: `dlq_${entry.originalJobId}`,
    });
    log.warn('Job moved to DLQ', {
      originalJobId: entry.originalJobId,
      reason: entry.failureReason,
      attempts: entry.totalAttempts,
    });
    metricsService.recordDLQEntry();
    return job;
  }

  async listEntries(
    start: number = 0,
    end: number = 50,
  ): Promise<BullJob<DLQEntry>[]> {
    return this.queue.getJobs(['failed', 'completed', 'waiting'], start, end);
  }

  async replayJob(dlqJobId: string, mainQueue: Queue): Promise<void> {
    const job = await this.queue.getJob(dlqJobId);
    if (!job) throw new Error(`DLQ entry not found: ${dlqJobId}`);

    const entry = job.data;
    await mainQueue.add(entry.type, {
      jobId: entry.originalJobId,
      type: entry.type,
      payload: entry.payload,
      organizationId: entry.organizationId,
      attemptNumber: entry.totalAttempts + 1,
    });

    await job.remove();
    log.info('DLQ job replayed', { originalJobId: entry.originalJobId });
  }

  async getCount(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'completed', 'failed');
    return Object.values(counts).reduce((a, b) => a + b, 0);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  getQueue(): Queue<DLQEntry> {
    return this.queue;
  }
}

export const deadLetterQueue = new DeadLetterQueueClass();
