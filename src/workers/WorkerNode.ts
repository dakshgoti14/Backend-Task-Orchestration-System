/**
 * WorkerNode — a self-contained BullMQ worker process.
 *
 * Each WorkerNode:
 *  1. Registers itself in the database on startup
 *  2. Connects to BullMQ and processes jobs concurrently
 *  3. Sends heartbeats to indicate liveness
 *  4. Reports job results back via JobService
 *  5. Handles graceful shutdown (SIGTERM/SIGINT)
 *
 * Workers are stateless and can be horizontally scaled.
 * Run: npm run worker
 */

import { Worker as BullWorker, Job as BullJob } from 'bullmq';
import os from 'os';
import { config } from '../utils/config';
import { createLogger } from '../utils/logger';
import { jobExecutor } from './JobExecutor';
import { workerRepository } from '../db/repositories/WorkerRepository';
import { executionRepository } from '../db/repositories/ExecutionRepository';
import { jobRepository } from '../db/repositories/JobRepository';
import { deadLetterQueue } from '../queue/DeadLetterQueue';
import { jobScheduler } from '../scheduler/JobScheduler';
import { metricsService } from '../monitoring/MetricsService';
import { connectDatabase } from '../db/index';
import { computeRetryDelay } from '../utils/helpers';
import { QueueJobPayload } from '../queue/JobQueue';

const log = createLogger('WorkerNode');

const REDIS_CONNECTION = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  db: config.redis.db,
  keyPrefix: config.redis.keyPrefix,
  maxRetriesPerRequest: null,
};

class WorkerNodeProcess {
  private workerId!: string;
  private bullWorker!: BullWorker<QueueJobPayload>;
  private heartbeatTimer!: NodeJS.Timeout;
  private startedAt = Date.now();

  async start(): Promise<void> {
    log.info('WorkerNode starting up', { pid: process.pid, hostname: os.hostname() });

    await connectDatabase();

    // Register this worker node in the database
    const worker = await workerRepository.register({
      hostname: os.hostname(),
      ipAddress: this.getLocalIp(),
      pid: process.pid,
      version: process.env.npm_package_version ?? '1.0.0',
      capabilities: {
        jobTypes: [
          'HTTP_REQUEST', 'SHELL_COMMAND', 'DATA_PIPELINE',
          'EMAIL_NOTIFICATION', 'REPORT_GENERATION', 'FILE_PROCESSING',
          'DATABASE_CLEANUP', 'WEBHOOK', 'CUSTOM',
        ],
        maxConcurrency: config.worker.concurrency,
        gpuEnabled: false,
        region: process.env.WORKER_REGION ?? 'us-east-1',
        labels: {
          env: config.app.env,
          version: process.env.npm_package_version ?? '1.0.0',
        },
      },
    });

    this.workerId = worker.id;
    log.info('Worker registered', { workerId: this.workerId });

    // Create BullMQ worker consuming from the job queue
    this.bullWorker = new BullWorker<QueueJobPayload>(
      config.queue.name,
      async (bullJob) => this.processJob(bullJob),
      {
        connection: REDIS_CONNECTION,
        concurrency: config.worker.concurrency,
        lockDuration: config.worker.jobTimeoutMs + 10_000, // slightly longer than timeout
        stalledInterval: 30_000,
        maxStalledCount: 2,
      },
    );

    this.attachWorkerEventHandlers();
    this.startHeartbeat();

    log.info('WorkerNode online', {
      workerId: this.workerId,
      concurrency: config.worker.concurrency,
      queue: config.queue.name,
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT',  () => this.shutdown('SIGINT'));
    process.on('uncaughtException', (err) => {
      log.error('Uncaught exception in worker', { error: err });
      this.shutdown('uncaughtException');
    });
  }

  private async processJob(bullJob: BullJob<QueueJobPayload>): Promise<void> {
    const { jobId, type, payload, organizationId, attemptNumber } = bullJob.data;
    log.info('Processing job', { jobId, type, attemptNumber });

    // Fetch full job from DB
    const job = await jobRepository.findById(jobId);
    if (!job) {
      log.warn('Job not found in DB (may have been deleted)', { jobId });
      return;
    }

    if (job.status === 'CANCELLED') {
      log.info('Job was cancelled, skipping', { jobId });
      return;
    }

    // Create execution log row
    const execLog = await executionRepository.create({
      jobId,
      workerId: this.workerId,
      attemptNumber,
      status: 'RUNNING',
      startedAt: new Date(),
    });

    // Update job to RUNNING
    await jobRepository.update(jobId, {
      status: 'RUNNING',
      workerId: this.workerId,
      startedAt: new Date(),
    });

    metricsService.setWorkerLoad(
      this.workerId,
      bullJob.attemptsMade / config.worker.concurrency,
    );

    // Execute the job
    const result = await jobExecutor.execute(job);
    const completedAt = new Date();

    if (result.success) {
      // ── SUCCESS ──────────────────────────────────────────────────────────
      await Promise.all([
        jobRepository.update(jobId, {
          status: 'COMPLETED',
          completedAt,
          result: result.result,
          exitCode: result.exitCode,
        }),
        executionRepository.complete({
          id: execLog.id,
          status: 'COMPLETED',
          completedAt,
          durationMs: result.durationMs,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          result: result.result,
        }),
      ]);

      await jobScheduler.onJobCompleted(jobId, 'COMPLETED');
      log.info('Job completed', { jobId, durationMs: result.durationMs });

    } else if (result.errorCode === 'JOB_TIMEOUT') {
      // ── TIMEOUT ──────────────────────────────────────────────────────────
      await this.handleFailure(jobId, execLog.id, result, completedAt, 'TIMED_OUT');
      metricsService.recordJobTimedOut();

    } else {
      // ── FAILURE ──────────────────────────────────────────────────────────
      await this.handleFailure(jobId, execLog.id, result, completedAt, 'FAILED');
    }
  }

  private async handleFailure(
    jobId: string,
    execLogId: string,
    result: Awaited<ReturnType<typeof jobExecutor.execute>>,
    completedAt: Date,
    finalStatus: 'FAILED' | 'TIMED_OUT',
  ): Promise<void> {
    const job = await jobRepository.findById(jobId);
    if (!job) return;

    await executionRepository.complete({
      id: execLogId,
      status: finalStatus === 'TIMED_OUT' ? 'TIMED_OUT' : 'FAILED',
      completedAt,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      errorMessage: result.errorMessage,
      errorStack: result.errorStack,
      errorCode: result.errorCode,
    });

    const newRetryCount = job.retryCount + 1;

    if (newRetryCount <= job.maxRetries) {
      // Retry with backoff
      const delayMs = computeRetryDelay(
        job.retryConfig.retryDelay,
        newRetryCount,
        job.retryConfig.retryBackoff,
      );

      await jobRepository.update(jobId, {
        status: 'RETRYING',
        retryCount: newRetryCount,
        workerId: undefined,
        startedAt: undefined,
      });

      // BullMQ will automatically retry via its retry policy.
      // We log and emit metrics here.
      metricsService.recordJobRetried(job.type);
      log.warn('Job failed, will retry', {
        jobId,
        attempt: newRetryCount,
        maxRetries: job.maxRetries,
        delayMs,
      });

    } else {
      // Exhausted retries — move to DLQ
      await jobRepository.update(jobId, {
        status: 'FAILED',
        completedAt,
        errorMessage: result.errorMessage,
        errorStack: result.errorStack,
        exitCode: result.exitCode,
      });

      await deadLetterQueue.add({
        originalJobId: jobId,
        type: job.type,
        payload: job.payload,
        organizationId: job.organizationId,
        failureReason: result.errorMessage ?? 'Unknown error',
        failureStack: result.errorStack,
        totalAttempts: newRetryCount,
        firstFailedAt: job.startedAt ?? completedAt,
        lastFailedAt: completedAt,
      });

      await jobScheduler.onJobCompleted(jobId, 'FAILED');
      metricsService.recordJobFailed(job.type, job.priority, result.errorCode ?? 'UNKNOWN');
      log.error('Job permanently failed, moved to DLQ', { jobId, attempts: newRetryCount });
    }
  }

  private attachWorkerEventHandlers(): void {
    this.bullWorker.on('completed', (job) => {
      log.debug('BullMQ job ack received', { bullJobId: job.id });
    });

    this.bullWorker.on('failed', (job, err) => {
      log.warn('BullMQ job failed event', { bullJobId: job?.id, error: err?.message });
    });

    this.bullWorker.on('error', (err) => {
      log.error('BullMQ worker error', { error: err });
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        const bullCounts = await this.bullWorker.getActiveCount?.() ?? 0;
        await workerRepository.heartbeat({
          workerId: this.workerId,
          status: bullCounts > 0 ? 'BUSY' : 'ONLINE',
          currentJobCount: typeof bullCounts === 'number' ? bullCounts : 0,
          stats: {
            uptimeMs: Date.now() - this.startedAt,
            currentLoad: (typeof bullCounts === 'number' ? bullCounts : 0) / config.worker.concurrency,
          },
          timestamp: new Date(),
        });
      } catch (err) {
        log.warn('Heartbeat failed', { error: err });
      }
    }, config.worker.heartbeatIntervalMs);
  }

  private async shutdown(signal: string): Promise<void> {
    log.info(`WorkerNode shutting down (${signal})`);

    clearInterval(this.heartbeatTimer);

    // Drain the worker: stop accepting new jobs but finish current ones
    await workerRepository.updateStatus(this.workerId, 'DRAINING');
    await this.bullWorker.close(true /* graceful */);
    await workerRepository.updateStatus(this.workerId, 'OFFLINE');

    log.info('WorkerNode shutdown complete');
    process.exit(0);
  }

  private getLocalIp(): string {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] ?? []) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
    return '127.0.0.1';
  }
}

// Entry point when run directly
if (require.main === module) {
  const worker = new WorkerNodeProcess();
  worker.start().catch((err) => {
    log.error('Worker failed to start', { error: err });
    process.exit(1);
  });
}

export { WorkerNodeProcess };
