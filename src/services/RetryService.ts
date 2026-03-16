/**
 * RetryService — manages retry policy evaluation and DLQ replayback.
 *
 * Centralises all retry-related logic:
 *  - Should this error be retried? (error code filtering)
 *  - What delay to apply? (backoff strategy)
 *  - DLQ replay: re-submit a failed job for another run
 */

import { jobRepository } from '../db/repositories/JobRepository';
import { jobQueue } from '../queue/JobQueue';
import { deadLetterQueue } from '../queue/DeadLetterQueue';
import { computeRetryDelay } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { Job } from '../models/Job';
import { metricsService } from '../monitoring/MetricsService';

const log = createLogger('RetryService');

// Error codes that should NEVER be retried (permanent failures)
const PERMANENT_ERRORS = new Set([
  'SECURITY_VIOLATION',
  'HANDLER_NOT_FOUND',
  'UNKNOWN_JOB_TYPE',
  'PERMISSION_DENIED',
  'RESOURCE_NOT_FOUND',
]);

export class RetryService {
  /**
   * Determine if a job should be retried given its error code.
   */
  shouldRetry(job: Job, errorCode?: string): boolean {
    if (job.retryCount >= job.maxRetries) return false;
    if (errorCode && PERMANENT_ERRORS.has(errorCode)) return false;

    // If retryOn is specified, only retry on those error codes
    if (job.retryConfig.retryOn.length > 0) {
      if (!errorCode) return false;
      return job.retryConfig.retryOn.includes(errorCode);
    }

    return true;
  }

  /**
   * Compute the delay before the next retry attempt.
   */
  getRetryDelay(job: Job): number {
    return computeRetryDelay(
      job.retryConfig.retryDelay,
      job.retryCount + 1,
      job.retryConfig.retryBackoff,
    );
  }

  /**
   * Re-queue a job for retry from the API (manual retry endpoint).
   */
  async manualRetry(jobId: string): Promise<void> {
    const job = await jobRepository.findById(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    await jobRepository.update(jobId, {
      status: 'PENDING',
      retryCount: job.retryCount,
      workerId: undefined,
      startedAt: undefined,
      completedAt: undefined,
      errorMessage: undefined,
    });

    log.info('Manual retry triggered', { jobId, currentRetryCount: job.retryCount });
    metricsService.recordJobRetried(job.type);
  }

  /**
   * Replay all jobs from the DLQ.
   * Returns the number of jobs replayed.
   */
  async replayAllDLQ(): Promise<number> {
    const entries = await deadLetterQueue.listEntries(0, 100);
    let replayed = 0;

    for (const entry of entries) {
      try {
        await deadLetterQueue.replayJob(entry.id!, jobQueue.getQueue());
        replayed++;
      } catch (err) {
        log.error('DLQ replay failed for entry', { id: entry.id, error: err });
      }
    }

    log.info('DLQ replay complete', { replayed, total: entries.length });
    return replayed;
  }

  /**
   * Replay a single DLQ entry by its DLQ job ID.
   */
  async replayDLQEntry(dlqJobId: string): Promise<void> {
    await deadLetterQueue.replayJob(dlqJobId, jobQueue.getQueue());
    log.info('DLQ entry replayed', { dlqJobId });
  }

  /**
   * Get a summary of the current DLQ state.
   */
  async getDLQSummary(): Promise<{ count: number; entries: Array<{ id?: string; originalJobId: string; failureReason: string; totalAttempts: number }> }> {
    const count = await deadLetterQueue.getCount();
    const rawEntries = await deadLetterQueue.listEntries(0, 20);
    const entries = rawEntries.map((e) => ({
      id: e.id,
      originalJobId: e.data.originalJobId,
      failureReason: e.data.failureReason,
      totalAttempts: e.data.totalAttempts,
    }));
    return { count, entries };
  }
}

export const retryService = new RetryService();
