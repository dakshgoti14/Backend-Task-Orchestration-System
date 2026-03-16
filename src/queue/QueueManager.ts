/**
 * QueueManager — unified façade over all queue instances.
 *
 * Responsibilities:
 *  - Start / stop all queues gracefully
 *  - Provide aggregate queue statistics
 *  - Coordinate between main queue and DLQ
 *  - Expose queue depth for autoscaling decisions
 */

import { jobQueue } from './JobQueue';
import { deadLetterQueue } from './DeadLetterQueue';
import { createLogger } from '../utils/logger';

const log = createLogger('QueueManager');

export interface QueueHealth {
  mainQueue: Record<string, number>;
  dlqCount: number;
  isHealthy: boolean;
}

class QueueManagerClass {
  async start(): Promise<void> {
    log.info('Queue system starting');
    // Queues are lazily initialized; nothing to start explicitly
    // but we verify connectivity here
    await this.getHealth();
    log.info('Queue system ready');
  }

  async stop(): Promise<void> {
    log.info('Queue system stopping');
    await jobQueue.close();
    await deadLetterQueue.close();
    log.info('Queue system stopped');
  }

  async getHealth(): Promise<QueueHealth> {
    const [mainCounts, dlqCount] = await Promise.all([
      jobQueue.getJobCounts(),
      deadLetterQueue.getCount(),
    ]);

    const isHealthy =
      (mainCounts.waiting ?? 0) < 10_000 && // queue not severely backed up
      dlqCount < 1_000;                       // DLQ not overwhelmed

    return { mainQueue: mainCounts, dlqCount, isHealthy };
  }

  async getQueueDepth(): Promise<number> {
    const counts = await jobQueue.getJobCounts();
    return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
  }

  async pauseMainQueue(): Promise<void> {
    await jobQueue.pause();
  }

  async resumeMainQueue(): Promise<void> {
    await jobQueue.resume();
  }
}

export const queueManager = new QueueManagerClass();
