import { Knex } from 'knex';
import { db, TABLES } from '../index';
import {
  Job,
  CreateJobDto,
  UpdateJobDto,
  JobFilter,
  PaginatedJobs,
  JobStatus,
} from '../../models/Job';
import { generateId } from '../../utils/helpers';
import { createLogger } from '../../utils/logger';

const log = createLogger('JobRepository');

// Map camelCase model fields to snake_case DB columns
function toRow(data: Partial<Job>): Record<string, unknown> {
  const map: Record<string, string> = {
    scheduledAt: 'scheduled_at',
    cronExpression: 'cron_expression',
    nextRunAt: 'next_run_at',
    lastRunAt: 'last_run_at',
    workerId: 'worker_id',
    startedAt: 'started_at',
    completedAt: 'completed_at',
    timeoutMs: 'timeout_ms',
    retryConfig: 'retry_config',
    retryCount: 'retry_count',
    maxRetries: 'max_retries',
    dependencyCount: 'dependency_count',
    resolvedDependencyCount: 'resolved_dependency_count',
    errorMessage: 'error_message',
    errorStack: 'error_stack',
    exitCode: 'exit_code',
    organizationId: 'organization_id',
    createdBy: 'created_by',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  };

  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const col = map[key] ?? key;
    if (value !== undefined) {
      row[col] = typeof value === 'object' && value !== null && !(value instanceof Date)
        ? JSON.stringify(value)
        : value;
    }
  }
  return row;
}

// Map snake_case DB columns back to camelCase model
function fromRow(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    type: row.type as Job['type'],
    payload: row.payload as Job['payload'],
    status: row.status as JobStatus,
    priority: row.priority as Job['priority'],
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string) : undefined,
    cronExpression: row.cron_expression as string | undefined,
    timezone: row.timezone as string,
    nextRunAt: row.next_run_at ? new Date(row.next_run_at as string) : undefined,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : undefined,
    workerId: row.worker_id as string | undefined,
    startedAt: row.started_at ? new Date(row.started_at as string) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
    timeoutMs: row.timeout_ms as number,
    retryConfig: row.retry_config as Job['retryConfig'],
    retryCount: row.retry_count as number,
    maxRetries: row.max_retries as number,
    dependencies: row.dependencies as Job['dependencies'],
    dependencyCount: row.dependency_count as number,
    resolvedDependencyCount: row.resolved_dependency_count as number,
    result: row.result as Record<string, unknown> | undefined,
    errorMessage: row.error_message as string | undefined,
    errorStack: row.error_stack as string | undefined,
    exitCode: row.exit_code as number | undefined,
    organizationId: row.organization_id as string,
    createdBy: row.created_by as string,
    tags: row.tags as string[],
    metadata: row.metadata as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class JobRepository {
  private table = TABLES.JOBS;

  async create(dto: CreateJobDto): Promise<Job> {
    const id = generateId();
    const now = new Date();

    const row = {
      id,
      name: dto.name,
      description: dto.description,
      type: dto.type,
      payload: JSON.stringify(dto.payload),
      status: 'PENDING',
      priority: dto.priority ?? 'MEDIUM',
      scheduled_at: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      cron_expression: dto.cronExpression ?? null,
      timezone: dto.timezone ?? 'UTC',
      timeout_ms: dto.timeoutMs ?? 300_000,
      retry_config: JSON.stringify({
        maxRetries: dto.retryConfig?.maxRetries ?? 3,
        retryDelay: dto.retryConfig?.retryDelay ?? 5000,
        retryBackoff: dto.retryConfig?.retryBackoff ?? 'EXPONENTIAL',
        retryOn: dto.retryConfig?.retryOn ?? [],
      }),
      max_retries: dto.retryConfig?.maxRetries ?? 3,
      retry_count: 0,
      dependencies: JSON.stringify(dto.dependencies ?? []),
      dependency_count: (dto.dependencies ?? []).length,
      resolved_dependency_count: 0,
      organization_id: dto.organizationId,
      created_by: dto.createdBy,
      tags: dto.tags ?? [],
      metadata: JSON.stringify(dto.metadata ?? {}),
      created_at: now,
      updated_at: now,
    };

    const [inserted] = await db(this.table).insert(row).returning('*');
    return fromRow(inserted);
  }

  async findById(id: string): Promise<Job | null> {
    const row = await db(this.table).where({ id }).first();
    return row ? fromRow(row) : null;
  }

  async findMany(filter: JobFilter): Promise<PaginatedJobs> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
      ...conditions
    } = filter;

    const colMap: Record<string, string> = {
      createdAt: 'created_at',
      scheduledAt: 'scheduled_at',
      priority: 'priority',
      status: 'status',
    };

    const query = db(this.table);

    if (conditions.status) {
      const statuses = Array.isArray(conditions.status) ? conditions.status : [conditions.status];
      query.whereIn('status', statuses);
    }
    if (conditions.priority) {
      const priorities = Array.isArray(conditions.priority)
        ? conditions.priority
        : [conditions.priority];
      query.whereIn('priority', priorities);
    }
    if (conditions.type)           query.where({ type: conditions.type });
    if (conditions.organizationId) query.where({ organization_id: conditions.organizationId });
    if (conditions.createdBy)      query.where({ created_by: conditions.createdBy });
    if (conditions.tags?.length)   query.whereRaw('tags @> ?', [conditions.tags]);
    if (conditions.scheduledBefore) query.where('scheduled_at', '<=', conditions.scheduledBefore);
    if (conditions.scheduledAfter)  query.where('scheduled_at', '>=', conditions.scheduledAfter);
    if (conditions.createdBefore)   query.where('created_at', '<=', conditions.createdBefore);
    if (conditions.createdAfter)    query.where('created_at', '>=', conditions.createdAfter);
    if (conditions.search) {
      query.whereRaw('name ILIKE ?', [`%${conditions.search}%`]);
    }

    const countResult = await query.clone().count('id as count').first();
    const total = parseInt(String(countResult?.count ?? 0), 10);

    const rows = await query
      .orderBy(colMap[sortBy] ?? 'created_at', sortOrder)
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data: rows.map(fromRow),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async update(id: string, dto: UpdateJobDto): Promise<Job | null> {
    const row = toRow(dto as Partial<Job>);
    const [updated] = await db(this.table).where({ id }).update(row).returning('*');
    return updated ? fromRow(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const count = await db(this.table).where({ id }).delete();
    return count > 0;
  }

  /**
   * Atomically claim a set of runnable jobs for the scheduler.
   * Returns jobs moved from PENDING → QUEUED.
   */
  async claimPendingJobs(limit: number = 50): Promise<Job[]> {
    const now = new Date();

    // Use a subquery to select + lock rows atomically
    const rows = await db.raw(`
      UPDATE ${this.table}
      SET status = 'QUEUED', updated_at = NOW()
      WHERE id IN (
        SELECT id FROM ${this.table}
        WHERE status = 'PENDING'
          AND (scheduled_at IS NULL OR scheduled_at <= :now)
          AND dependency_count = resolved_dependency_count
        ORDER BY
          CASE priority
            WHEN 'CRITICAL'   THEN 1
            WHEN 'HIGH'       THEN 2
            WHEN 'MEDIUM'     THEN 3
            WHEN 'LOW'        THEN 4
            WHEN 'BACKGROUND' THEN 5
          END,
          scheduled_at ASC NULLS LAST,
          created_at ASC
        LIMIT :limit
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `, { now, limit });

    return (rows.rows as Record<string, unknown>[]).map(fromRow);
  }

  /**
   * Find jobs that are stuck in RUNNING state (worker crashed).
   */
  async findStalledJobs(staleThresholdMs: number = 60_000): Promise<Job[]> {
    const staleThreshold = new Date(Date.now() - staleThresholdMs);
    const rows = await db(this.table)
      .where('status', 'RUNNING')
      .where('started_at', '<=', staleThreshold)
      .select('*');
    return rows.map(fromRow);
  }

  /**
   * Increment resolved_dependency_count for jobs that depend on a completed job.
   */
  async resolveDependency(completedJobId: string): Promise<void> {
    await db.raw(`
      UPDATE ${this.table}
      SET resolved_dependency_count = resolved_dependency_count + 1,
          updated_at = NOW()
      WHERE dependencies @> :dep::jsonb
        AND status = 'PENDING'
    `, { dep: JSON.stringify([{ jobId: completedJobId }]) });
  }

  /**
   * Fetch due cron jobs (next_run_at is in the past and job is active).
   */
  async findDueCronJobs(): Promise<Job[]> {
    const rows = await db(this.table)
      .whereNotNull('cron_expression')
      .where('next_run_at', '<=', new Date())
      .whereIn('status', ['PENDING', 'COMPLETED', 'FAILED'])
      .forUpdate()
      .skipLocked()
      .select('*');
    return rows.map(fromRow);
  }

  async bulkUpdateStatus(ids: string[], status: JobStatus, trx?: Knex.Transaction): Promise<void> {
    const q = trx ? trx(this.table) : db(this.table);
    await q.whereIn('id', ids).update({ status, updated_at: new Date() });
  }
}

export const jobRepository = new JobRepository();
