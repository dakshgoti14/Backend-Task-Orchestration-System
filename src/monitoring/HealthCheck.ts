/**
 * HealthCheck — periodic background health checks.
 * Detects lost workers and stalled jobs independently of HTTP requests.
 */

import { workerService } from '../services/WorkerService';
import { jobRepository } from '../db/repositories/JobRepository';
import { createLogger } from '../utils/logger';
import { metricsService } from './MetricsService';

const log = createLogger('HealthCheck');

export class HealthCheck {
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;

  constructor(intervalMs: number = 30_000) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    this.timer = setInterval(() => this.run(), this.intervalMs);
    log.info('HealthCheck started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    await Promise.allSettled([
      this.checkWorkers(),
      this.refreshWorkerMetrics(),
    ]);
  }

  private async checkWorkers(): Promise<void> {
    const lostIds = await workerService.detectAndMarkLostWorkers(30_000);
    if (lostIds.length > 0) {
      log.warn(`Detected ${lostIds.length} lost worker(s)`, { ids: lostIds });
    }
  }

  private async refreshWorkerMetrics(): Promise<void> {
    const metrics = await workerService.getWorkerMetrics();
    metricsService.setWorkerCount('ONLINE', metrics.online);
    metricsService.setWorkerCount('BUSY', metrics.busy);
    metricsService.setWorkerCount('OFFLINE', metrics.offline);
    metricsService.setWorkerCount('LOST', metrics.lost);
  }
}

export const healthCheck = new HealthCheck();
