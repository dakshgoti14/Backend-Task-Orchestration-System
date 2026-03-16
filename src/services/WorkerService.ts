/**
 * WorkerService — business logic for worker node management.
 */

import { workerRepository } from '../db/repositories/WorkerRepository';
import { notificationService } from './NotificationService';
import { metricsService } from '../monitoring/MetricsService';
import { createLogger } from '../utils/logger';
import { WorkerNode, WorkerFilter, RegisterWorkerDto, WorkerHeartbeatDto } from '../models/Worker';

const log = createLogger('WorkerService');

export class WorkerService {
  async registerWorker(dto: RegisterWorkerDto): Promise<WorkerNode> {
    const worker = await workerRepository.register(dto);
    log.info('Worker registered', { workerId: worker.id, hostname: worker.hostname });
    metricsService.setWorkerCount('ONLINE', 1);
    return worker;
  }

  async getWorker(id: string): Promise<WorkerNode> {
    const worker = await workerRepository.findById(id);
    if (!worker) throw new Error(`Worker not found: ${id}`);
    return worker;
  }

  async listWorkers(filter: WorkerFilter = {}): Promise<WorkerNode[]> {
    return workerRepository.findAll(filter);
  }

  async heartbeat(dto: WorkerHeartbeatDto): Promise<void> {
    await workerRepository.heartbeat(dto);
  }

  async detectAndMarkLostWorkers(heartbeatTimeoutMs: number = 30_000): Promise<string[]> {
    const lostIds = await workerRepository.markLostWorkers(heartbeatTimeoutMs);

    for (const id of lostIds) {
      const worker = await workerRepository.findById(id);
      if (worker) {
        await notificationService.notifyWorkerLost(id, worker.hostname);
        log.warn('Worker marked as LOST', { workerId: id, hostname: worker.hostname });
      }
    }

    return lostIds;
  }

  async getWorkerMetrics(): Promise<{
    total: number;
    online: number;
    busy: number;
    offline: number;
    lost: number;
    totalCapacity: number;
    usedCapacity: number;
  }> {
    const all = await workerRepository.findAll();
    const byStatus = all.reduce<Record<string, number>>((acc, w) => {
      acc[w.status] = (acc[w.status] ?? 0) + 1;
      return acc;
    }, {});

    const totalCapacity = all.reduce((s, w) => s + w.maxConcurrency, 0);
    const usedCapacity  = all.reduce((s, w) => s + w.currentJobCount, 0);

    return {
      total: all.length,
      online: byStatus['ONLINE'] ?? 0,
      busy: byStatus['BUSY'] ?? 0,
      offline: byStatus['OFFLINE'] ?? 0,
      lost: byStatus['LOST'] ?? 0,
      totalCapacity,
      usedCapacity,
    };
  }
}

export const workerService = new WorkerService();
