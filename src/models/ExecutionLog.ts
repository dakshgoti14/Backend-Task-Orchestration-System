/**
 * ExecutionLog Model — immutable record of each job execution attempt.
 *
 * Every time a job transitions from QUEUED → RUNNING, a new ExecutionLog row
 * is created. This provides full audit history across retries.
 */

export type ExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';

export interface ExecutionLog {
  id: string;
  jobId: string;
  workerId: string;
  attemptNumber: number;        // 1-indexed retry attempt

  status: ExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;

  // Captured output
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  result?: Record<string, unknown>;

  // Error info
  errorMessage?: string;
  errorStack?: string;
  errorCode?: string;

  // Resource usage
  peakMemoryMb?: number;
  cpuPercent?: number;

  createdAt: Date;
}

export interface CreateExecutionLogDto {
  jobId: string;
  workerId: string;
  attemptNumber: number;
  status: ExecutionStatus;
  startedAt: Date;
}

export interface CompleteExecutionLogDto {
  id: string;
  status: ExecutionStatus;
  completedAt: Date;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  result?: Record<string, unknown>;
  errorMessage?: string;
  errorStack?: string;
  errorCode?: string;
  peakMemoryMb?: number;
  cpuPercent?: number;
}

export interface Schedule {
  id: string;
  name: string;
  description?: string;
  cronExpression: string;
  timezone: string;
  jobTemplate: {
    type: string;
    payload: Record<string, unknown>;
    priority: string;
    timeoutMs: number;
    retryConfig: Record<string, unknown>;
    tags: string[];
  };
  isActive: boolean;
  lastTriggeredAt?: Date;
  nextTriggerAt?: Date;
  totalTriggeredCount: number;
  organizationId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduleDto {
  name: string;
  description?: string;
  cronExpression: string;
  timezone?: string;
  jobTemplate: Schedule['jobTemplate'];
  organizationId: string;
  createdBy: string;
}
