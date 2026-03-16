/**
 * MetricsService — Prometheus metrics collection via prom-client.
 *
 * Exposes:
 *  - Job counters (submitted, completed, failed, retried, dlq)
 *  - Job execution duration histograms
 *  - Queue depth gauges
 *  - Worker count and load gauges
 *  - API request counters + latency histograms
 */

import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { createLogger } from '../utils/logger';

const log = createLogger('MetricsService');

class MetricsServiceClass {
  public registry: Registry;

  // ─── Job counters ─────────────────────────────────────────────────────────
  private jobsSubmitted: Counter;
  private jobsCompleted: Counter;
  private jobsFailed: Counter;
  private jobsRetried: Counter;
  private jobsCancelled: Counter;
  private jobsTimedOut: Counter;
  private dlqEntries: Counter;

  // ─── Queue gauges ─────────────────────────────────────────────────────────
  private queueDepth: Gauge;
  private queueEvents: Counter;
  private bulkEnqueues: Counter;

  // ─── Execution duration ───────────────────────────────────────────────────
  private jobDuration: Histogram;

  // ─── Worker gauges ────────────────────────────────────────────────────────
  private workerCount: Gauge;
  private workerLoad: Gauge;

  // ─── API metrics ──────────────────────────────────────────────────────────
  private httpRequestsTotal: Counter;
  private httpRequestDuration: Histogram;
  private httpRequestsInFlight: Gauge;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.jobsSubmitted = new Counter({
      name: 'btos_jobs_submitted_total',
      help: 'Total number of jobs submitted',
      labelNames: ['type', 'priority', 'organization_id'],
      registers: [this.registry],
    });

    this.jobsCompleted = new Counter({
      name: 'btos_jobs_completed_total',
      help: 'Total number of jobs completed successfully',
      labelNames: ['type', 'priority'],
      registers: [this.registry],
    });

    this.jobsFailed = new Counter({
      name: 'btos_jobs_failed_total',
      help: 'Total number of jobs that failed permanently',
      labelNames: ['type', 'priority', 'error_code'],
      registers: [this.registry],
    });

    this.jobsRetried = new Counter({
      name: 'btos_jobs_retried_total',
      help: 'Total number of job retry attempts',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.jobsCancelled = new Counter({
      name: 'btos_jobs_cancelled_total',
      help: 'Total number of cancelled jobs',
      registers: [this.registry],
    });

    this.jobsTimedOut = new Counter({
      name: 'btos_jobs_timed_out_total',
      help: 'Total number of timed-out jobs',
      registers: [this.registry],
    });

    this.dlqEntries = new Counter({
      name: 'btos_dlq_entries_total',
      help: 'Total jobs moved to dead letter queue',
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: 'btos_queue_depth',
      help: 'Current number of jobs waiting in queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.queueEvents = new Counter({
      name: 'btos_queue_events_total',
      help: 'Queue event counts by type',
      labelNames: ['event'],
      registers: [this.registry],
    });

    this.bulkEnqueues = new Counter({
      name: 'btos_bulk_enqueue_jobs_total',
      help: 'Total jobs enqueued in bulk operations',
      registers: [this.registry],
    });

    this.jobDuration = new Histogram({
      name: 'btos_job_duration_seconds',
      help: 'Job execution duration in seconds',
      labelNames: ['type', 'status'],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });

    this.workerCount = new Gauge({
      name: 'btos_workers_total',
      help: 'Total number of registered worker nodes',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.workerLoad = new Gauge({
      name: 'btos_worker_load_ratio',
      help: 'Worker load ratio (current_jobs / max_concurrency)',
      labelNames: ['worker_id'],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new Counter({
      name: 'btos_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'path', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'btos_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.httpRequestsInFlight = new Gauge({
      name: 'btos_http_requests_in_flight',
      help: 'Number of HTTP requests currently in flight',
      registers: [this.registry],
    });

    log.info('Prometheus metrics initialized');
  }

  // ─── Public recording methods ─────────────────────────────────────────────

  recordJobSubmitted(type: string, priority: string, organizationId: string): void {
    this.jobsSubmitted.inc({ type, priority, organization_id: organizationId });
  }

  recordJobCompleted(type: string, priority: string, durationMs: number): void {
    this.jobsCompleted.inc({ type, priority });
    this.jobDuration.observe({ type, status: 'completed' }, durationMs / 1000);
  }

  recordJobFailed(type: string, priority: string, errorCode: string, durationMs?: number): void {
    this.jobsFailed.inc({ type, priority, error_code: errorCode });
    if (durationMs !== undefined) {
      this.jobDuration.observe({ type, status: 'failed' }, durationMs / 1000);
    }
  }

  recordJobRetried(type: string): void {
    this.jobsRetried.inc({ type });
  }

  recordJobCancelled(): void {
    this.jobsCancelled.inc();
  }

  recordJobTimedOut(): void {
    this.jobsTimedOut.inc();
  }

  recordDLQEntry(): void {
    this.dlqEntries.inc();
  }

  recordQueueEvent(event: string): void {
    this.queueEvents.inc({ event });
  }

  recordBulkEnqueue(count: number): void {
    this.bulkEnqueues.inc(count);
  }

  setQueueDepth(queue: string, depth: number): void {
    this.queueDepth.set({ queue }, depth);
  }

  setWorkerCount(status: string, count: number): void {
    this.workerCount.set({ status }, count);
  }

  setWorkerLoad(workerId: string, load: number): void {
    this.workerLoad.set({ worker_id: workerId }, load);
  }

  recordHttpRequest(method: string, path: string, statusCode: number, durationMs: number): void {
    this.httpRequestsTotal.inc({ method, path, status_code: String(statusCode) });
    this.httpRequestDuration.observe({ method, path }, durationMs / 1000);
  }

  incrementHttpInFlight(): void {
    this.httpRequestsInFlight.inc();
  }

  decrementHttpInFlight(): void {
    this.httpRequestsInFlight.dec();
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}

export const metricsService = new MetricsServiceClass();
