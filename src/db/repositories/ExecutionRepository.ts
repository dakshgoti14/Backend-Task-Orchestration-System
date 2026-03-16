import { db, TABLES } from '../index';
import {
  ExecutionLog,
  CreateExecutionLogDto,
  CompleteExecutionLogDto,
} from '../../models/ExecutionLog';
import { generateId } from '../../utils/helpers';

function fromRow(row: Record<string, unknown>): ExecutionLog {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    workerId: row.worker_id as string,
    attemptNumber: row.attempt_number as number,
    status: row.status as ExecutionLog['status'],
    startedAt: new Date(row.started_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
    durationMs: row.duration_ms as number | undefined,
    stdout: row.stdout as string | undefined,
    stderr: row.stderr as string | undefined,
    exitCode: row.exit_code as number | undefined,
    result: row.result as Record<string, unknown> | undefined,
    errorMessage: row.error_message as string | undefined,
    errorStack: row.error_stack as string | undefined,
    errorCode: row.error_code as string | undefined,
    peakMemoryMb: row.peak_memory_mb as number | undefined,
    cpuPercent: row.cpu_percent as number | undefined,
    createdAt: new Date(row.created_at as string),
  };
}

export class ExecutionRepository {
  private table = TABLES.EXECUTION_LOGS;

  async create(dto: CreateExecutionLogDto): Promise<ExecutionLog> {
    const row = {
      id: generateId(),
      job_id: dto.jobId,
      worker_id: dto.workerId,
      attempt_number: dto.attemptNumber,
      status: dto.status,
      started_at: dto.startedAt,
      created_at: new Date(),
    };
    const [inserted] = await db(this.table).insert(row).returning('*');
    return fromRow(inserted);
  }

  async complete(dto: CompleteExecutionLogDto): Promise<ExecutionLog | null> {
    const [updated] = await db(this.table)
      .where({ id: dto.id })
      .update({
        status: dto.status,
        completed_at: dto.completedAt,
        duration_ms: dto.durationMs,
        stdout: dto.stdout,
        stderr: dto.stderr,
        exit_code: dto.exitCode,
        result: dto.result ? JSON.stringify(dto.result) : null,
        error_message: dto.errorMessage,
        error_stack: dto.errorStack,
        error_code: dto.errorCode,
        peak_memory_mb: dto.peakMemoryMb,
        cpu_percent: dto.cpuPercent,
      })
      .returning('*');
    return updated ? fromRow(updated) : null;
  }

  async findByJobId(jobId: string): Promise<ExecutionLog[]> {
    const rows = await db(this.table)
      .where({ job_id: jobId })
      .orderBy('attempt_number', 'asc')
      .select('*');
    return rows.map(fromRow);
  }

  async getLatestAttempt(jobId: string): Promise<ExecutionLog | null> {
    const row = await db(this.table)
      .where({ job_id: jobId })
      .orderBy('attempt_number', 'desc')
      .first();
    return row ? fromRow(row) : null;
  }

  async countAttempts(jobId: string): Promise<number> {
    const result = await db(this.table).where({ job_id: jobId }).count('id as cnt').first();
    return parseInt(String(result?.cnt ?? 0), 10);
  }

  async getWorkerStats(workerId: string, sinceMs: number = 3_600_000): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    avgDurationMs: number;
  }> {
    const since = new Date(Date.now() - sinceMs);
    const rows = await db(this.table)
      .where({ worker_id: workerId })
      .where('started_at', '>=', since)
      .select('status', db.raw('AVG(duration_ms) as avg_duration'));

    let total = 0, succeeded = 0, failed = 0, avgDurationMs = 0;
    for (const r of rows) {
      total++;
      if (r.status === 'COMPLETED') succeeded++;
      if (r.status === 'FAILED' || r.status === 'TIMED_OUT') failed++;
      avgDurationMs = parseFloat(r.avg_duration ?? 0);
    }
    return { total, succeeded, failed, avgDurationMs };
  }
}

export const executionRepository = new ExecutionRepository();
