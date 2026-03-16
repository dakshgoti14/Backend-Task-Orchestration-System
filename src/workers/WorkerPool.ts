/**
 * WorkerPool — manages the lifecycle of in-process worker instances
 * when running in embedded (non-separate-process) mode.
 *
 * In production you'd typically run workers as separate processes/pods.
 * This class enables single-process operation for development and
 * testing, or for low-volume deployments.
 *
 * Autoscaling logic:
 *  - Monitors queue depth every SCALE_CHECK_INTERVAL_MS
 *  - Scales up if depth > workers * SCALE_UP_THRESHOLD
 *  - Scales down if depth < workers * SCALE_DOWN_THRESHOLD
 *  - Respects MIN_WORKERS and MAX_WORKERS bounds
 */

import { WorkerNodeProcess } from './WorkerNode';
import { queueManager } from '../queue/QueueManager';
import { workerRepository } from '../db/repositories/WorkerRepository';
import { metricsService } from '../monitoring/MetricsService';
import { createLogger } from '../utils/logger';

const log = createLogger('WorkerPool');

export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  scaleCheckIntervalMs: number;
  scaleUpThreshold: number;   // jobs per worker to trigger scale-up
  scaleDownThreshold: number; // jobs per worker to trigger scale-down
}

const DEFAULT_POOL_CONFIG: WorkerPoolConfig = {
  minWorkers: 1,
  maxWorkers: 10,
  scaleCheckIntervalMs: 15_000,
  scaleUpThreshold: 20,
  scaleDownThreshold: 5,
};

export class WorkerPool {
  private workers: WorkerNodeProcess[] = [];
  private cfg: WorkerPoolConfig;
  private scaleInterval: NodeJS.Timeout | null = null;

  constructor(cfg: Partial<WorkerPoolConfig> = {}) {
    this.cfg = { ...DEFAULT_POOL_CONFIG, ...cfg };
  }

  async start(): Promise<void> {
    log.info('WorkerPool starting', this.cfg);

    for (let i = 0; i < this.cfg.minWorkers; i++) {
      await this.addWorker();
    }

    this.scaleInterval = setInterval(() => this.autoScale(), this.cfg.scaleCheckIntervalMs);
    log.info(`WorkerPool ready with ${this.workers.length} worker(s)`);
  }

  async stop(): Promise<void> {
    if (this.scaleInterval) clearInterval(this.scaleInterval);
    log.info('WorkerPool stopping all workers');
    // Workers handle their own shutdown via signals
    this.workers = [];
    log.info('WorkerPool stopped');
  }

  private async addWorker(): Promise<void> {
    const worker = new WorkerNodeProcess();
    this.workers.push(worker);
    log.info(`Worker added (total: ${this.workers.length})`);
  }

  private async autoScale(): Promise<void> {
    try {
      const depth = await queueManager.getQueueDepth();
      const current = this.workers.length;
      const jobsPerWorker = current > 0 ? depth / current : depth;

      log.debug('AutoScale check', { depth, current, jobsPerWorker });

      if (jobsPerWorker > this.cfg.scaleUpThreshold && current < this.cfg.maxWorkers) {
        const toAdd = Math.min(
          Math.ceil(jobsPerWorker / this.cfg.scaleUpThreshold) - current,
          this.cfg.maxWorkers - current,
        );
        log.info(`AutoScale: scaling up by ${toAdd} worker(s)`, { depth, current });
        for (let i = 0; i < toAdd; i++) await this.addWorker();
      } else if (jobsPerWorker < this.cfg.scaleDownThreshold && current > this.cfg.minWorkers) {
        const toRemove = current - this.cfg.minWorkers;
        log.info(`AutoScale: scaling down by ${toRemove} worker(s)`, { depth, current });
        this.workers.splice(-toRemove, toRemove);
      }

      // Refresh metrics
      const dbWorkers = await workerRepository.findAll({ status: ['ONLINE', 'BUSY'] });
      for (const w of dbWorkers) {
        metricsService.setWorkerLoad(w.id, w.currentJobCount / w.maxConcurrency);
      }
      metricsService.setQueueDepth('main', depth);
    } catch (err) {
      log.error('AutoScale error', { error: err });
    }
  }

  get size(): number {
    return this.workers.length;
  }
}

export const workerPool = new WorkerPool();
