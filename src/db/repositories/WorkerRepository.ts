import { db, TABLES } from '../index';
import { WorkerNode, RegisterWorkerDto, WorkerHeartbeatDto, WorkerFilter, WorkerStatus } from '../../models/Worker';
import { generateId } from '../../utils/helpers';

function fromRow(row: Record<string, unknown>): WorkerNode {
  return {
    id: row.id as string,
    hostname: row.hostname as string,
    ipAddress: row.ip_address as string,
    pid: row.pid as number,
    version: row.version as string,
    status: row.status as WorkerStatus,
    capabilities: row.capabilities as WorkerNode['capabilities'],
    stats: row.stats as WorkerNode['stats'],
    currentJobCount: row.current_job_count as number,
    maxConcurrency: row.max_concurrency as number,
    lastHeartbeatAt: new Date(row.last_heartbeat_at as string),
    registeredAt: new Date(row.registered_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class WorkerRepository {
  private table = TABLES.WORKERS;

  async register(dto: RegisterWorkerDto): Promise<WorkerNode> {
    const id = generateId();
    const now = new Date();
    const row = {
      id,
      hostname: dto.hostname,
      ip_address: dto.ipAddress,
      pid: dto.pid,
      version: dto.version,
      status: 'ONLINE',
      capabilities: JSON.stringify(dto.capabilities),
      stats: JSON.stringify({
        totalJobsProcessed: 0,
        totalJobsSucceeded: 0,
        totalJobsFailed: 0,
        totalJobsTimedOut: 0,
        averageJobDurationMs: 0,
        uptimeMs: 0,
        currentLoad: 0,
      }),
      current_job_count: 0,
      max_concurrency: dto.capabilities.maxConcurrency,
      last_heartbeat_at: now,
      registered_at: now,
      updated_at: now,
    };
    const [inserted] = await db(this.table).insert(row).returning('*');
    return fromRow(inserted);
  }

  async findById(id: string): Promise<WorkerNode | null> {
    const row = await db(this.table).where({ id }).first();
    return row ? fromRow(row) : null;
  }

  async findAll(filter: WorkerFilter = {}): Promise<WorkerNode[]> {
    const query = db(this.table);
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      query.whereIn('status', statuses);
    }
    const rows = await query.select('*');
    return rows.map(fromRow);
  }

  async heartbeat(dto: WorkerHeartbeatDto): Promise<void> {
    await db(this.table).where({ id: dto.workerId }).update({
      status: dto.status,
      current_job_count: dto.currentJobCount,
      last_heartbeat_at: dto.timestamp,
      stats: JSON.stringify(dto.stats),
      updated_at: new Date(),
    });
  }

  async updateStatus(id: string, status: WorkerStatus): Promise<void> {
    await db(this.table).where({ id }).update({ status, updated_at: new Date() });
  }

  /**
   * Mark workers as LOST if their heartbeat is older than threshold.
   */
  async markLostWorkers(heartbeatTimeoutMs: number): Promise<string[]> {
    const threshold = new Date(Date.now() - heartbeatTimeoutMs);
    const rows = await db(this.table)
      .whereIn('status', ['ONLINE', 'BUSY'])
      .where('last_heartbeat_at', '<', threshold)
      .update({ status: 'LOST', updated_at: new Date() })
      .returning('id');
    return rows.map((r: { id: string }) => r.id);
  }

  /**
   * Find the least-loaded worker that supports the given job type.
   */
  async findBestWorker(jobType: string): Promise<WorkerNode | null> {
    const row = await db(this.table)
      .whereIn('status', ['ONLINE', 'BUSY'])
      .whereRaw(`capabilities->'jobTypes' @> ?::jsonb`, [JSON.stringify([jobType])])
      .whereRaw('current_job_count < max_concurrency')
      .orderByRaw('current_job_count::float / NULLIF(max_concurrency, 0) ASC')
      .first();
    return row ? fromRow(row) : null;
  }

  async incrementJobCount(id: string, delta: 1 | -1): Promise<void> {
    await db(this.table)
      .where({ id })
      .update({
        current_job_count: db.raw('GREATEST(0, current_job_count + ?)', [delta]),
        updated_at: new Date(),
      });
  }
}

export const workerRepository = new WorkerRepository();
