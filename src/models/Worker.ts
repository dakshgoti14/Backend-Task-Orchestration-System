/**
 * Worker Node Model — represents an executor process in the distributed pool.
 *
 * Each worker registers itself in the database and Redis on startup,
 * sends heartbeats, and deregisters on graceful shutdown.
 */

export type WorkerStatus = 'ONLINE' | 'BUSY' | 'DRAINING' | 'OFFLINE' | 'LOST';

export interface WorkerCapabilities {
  jobTypes: string[];           // subset of JobType this worker handles
  maxConcurrency: number;       // max parallel jobs
  gpuEnabled: boolean;          // special capability flag
  region?: string;              // for geo-affinity routing
  labels: Record<string, string>; // k/v labels for affinity rules
}

export interface WorkerStats {
  totalJobsProcessed: number;
  totalJobsSucceeded: number;
  totalJobsFailed: number;
  totalJobsTimedOut: number;
  averageJobDurationMs: number;
  uptimeMs: number;
  currentLoad: number;          // 0.0–1.0
}

export interface WorkerNode {
  id: string;
  hostname: string;
  ipAddress: string;
  pid: number;
  version: string;              // app version string
  status: WorkerStatus;
  capabilities: WorkerCapabilities;
  stats: WorkerStats;

  currentJobCount: number;      // jobs currently running
  maxConcurrency: number;

  lastHeartbeatAt: Date;
  registeredAt: Date;
  updatedAt: Date;
}

export interface RegisterWorkerDto {
  hostname: string;
  ipAddress: string;
  pid: number;
  version: string;
  capabilities: WorkerCapabilities;
}

export interface WorkerHeartbeatDto {
  workerId: string;
  status: WorkerStatus;
  currentJobCount: number;
  stats: Partial<WorkerStats>;
  timestamp: Date;
}

export interface WorkerFilter {
  status?: WorkerStatus | WorkerStatus[];
  region?: string;
  jobType?: string;
  page?: number;
  limit?: number;
}
