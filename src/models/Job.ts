/**
 * Job Model — core domain entity for the orchestration platform.
 *
 * Lifecycle:  PENDING → QUEUED → RUNNING → COMPLETED
 *                                        ↘ FAILED → RETRYING → QUEUED (retry loop)
 *                                        ↘ CANCELLED
 *                                        ↘ TIMED_OUT
 */

export type JobStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRYING'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'SKIPPED';

export type JobPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'BACKGROUND';

export type JobType =
  | 'HTTP_REQUEST'
  | 'SHELL_COMMAND'
  | 'DATA_PIPELINE'
  | 'EMAIL_NOTIFICATION'
  | 'REPORT_GENERATION'
  | 'FILE_PROCESSING'
  | 'DATABASE_CLEANUP'
  | 'WEBHOOK'
  | 'CUSTOM';

export const PRIORITY_WEIGHT: Record<JobPriority, number> = {
  CRITICAL:   100,
  HIGH:        75,
  MEDIUM:      50,
  LOW:         25,
  BACKGROUND:   5,
};

export interface JobPayload {
  [key: string]: unknown;
}

export interface RetryConfig {
  maxRetries: number;           // default: 3
  retryDelay: number;           // base delay in ms; default: 5000
  retryBackoff: 'FIXED' | 'EXPONENTIAL' | 'JITTER';
  retryOn: string[];            // error codes/types to retry on; empty = all
}

export interface JobDependency {
  jobId: string;
  requireStatus: JobStatus[];   // e.g., ['COMPLETED'] — wait for these
}

export interface Job {
  id: string;
  name: string;
  description?: string;
  type: JobType;
  payload: JobPayload;
  status: JobStatus;
  priority: JobPriority;

  // Scheduling
  scheduledAt?: Date;           // one-off future execution
  cronExpression?: string;      // recurring schedule (cron syntax)
  timezone?: string;            // IANA timezone, default 'UTC'
  nextRunAt?: Date;             // computed next execution time (cron)
  lastRunAt?: Date;

  // Execution
  workerId?: string;            // assigned worker node
  startedAt?: Date;
  completedAt?: Date;
  timeoutMs: number;            // job-level timeout; default: 300000 (5 min)

  // Retry
  retryConfig: RetryConfig;
  retryCount: number;           // current retry attempt number
  maxRetries: number;           // convenience alias from retryConfig

  // Dependencies
  dependencies: JobDependency[];
  dependencyCount: number;      // total deps
  resolvedDependencyCount: number; // how many have met conditions

  // Output
  result?: Record<string, unknown>;
  errorMessage?: string;
  errorStack?: string;
  exitCode?: number;

  // Metadata
  organizationId: string;
  createdBy: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateJobDto {
  name: string;
  description?: string;
  type: JobType;
  payload: JobPayload;
  priority?: JobPriority;
  scheduledAt?: string | Date;
  cronExpression?: string;
  timezone?: string;
  timeoutMs?: number;
  retryConfig?: Partial<RetryConfig>;
  dependencies?: JobDependency[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  organizationId: string;
  createdBy: string;
}

export interface UpdateJobDto {
  status?: JobStatus;
  workerId?: string;
  startedAt?: Date;
  completedAt?: Date;
  result?: Record<string, unknown>;
  errorMessage?: string;
  errorStack?: string;
  exitCode?: number;
  retryCount?: number;
  nextRunAt?: Date;
  lastRunAt?: Date;
  resolvedDependencyCount?: number;
}

export interface JobFilter {
  status?: JobStatus | JobStatus[];
  priority?: JobPriority | JobPriority[];
  type?: JobType;
  organizationId?: string;
  createdBy?: string;
  tags?: string[];
  scheduledBefore?: Date;
  scheduledAfter?: Date;
  createdBefore?: Date;
  createdAfter?: Date;
  search?: string;              // full-text search on name/description
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'scheduledAt' | 'priority' | 'status';
  sortOrder?: 'ASC' | 'DESC';
}

export interface PaginatedJobs {
  data: Job[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
