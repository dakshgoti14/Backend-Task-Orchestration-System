/**
 * LoadBalancer — selects the optimal worker node for each job.
 *
 * Strategies supported:
 *  1. LEAST_LOADED     — pick worker with lowest current_job_count / max_concurrency ratio
 *  2. ROUND_ROBIN      — distribute evenly across eligible workers (ignores current load)
 *  3. AFFINITY         — prefer worker matching job's required labels/region
 *  4. RANDOM           — uniform random selection (useful for fault injection testing)
 *
 * Selection also filters by:
 *  - Worker status: ONLINE or BUSY (not DRAINING/OFFLINE/LOST)
 *  - Capability: worker.capabilities.jobTypes includes job.type
 *  - Capacity: current_job_count < max_concurrency
 */

import { WorkerNode } from '../models/Worker';
import { Job } from '../models/Job';
import { createLogger } from '../utils/logger';

const log = createLogger('LoadBalancer');

export type LoadBalancingStrategy = 'LEAST_LOADED' | 'ROUND_ROBIN' | 'AFFINITY' | 'RANDOM';

export class LoadBalancer {
  private rrIndex = 0;
  private strategy: LoadBalancingStrategy;

  constructor(strategy: LoadBalancingStrategy = 'LEAST_LOADED') {
    this.strategy = strategy;
    log.info('LoadBalancer initialized', { strategy });
  }

  /**
   * Select the best worker for a given job from the pool of available workers.
   * Returns null if no eligible worker is found.
   */
  selectWorker(job: Job, workers: WorkerNode[]): WorkerNode | null {
    const eligible = this.filterEligible(job, workers);

    if (eligible.length === 0) {
      log.debug('No eligible workers for job', {
        jobId: job.id,
        jobType: job.type,
        availableWorkers: workers.length,
      });
      return null;
    }

    let selected: WorkerNode;
    switch (this.strategy) {
      case 'LEAST_LOADED':
        selected = this.leastLoaded(eligible);
        break;
      case 'ROUND_ROBIN':
        selected = this.roundRobin(eligible);
        break;
      case 'AFFINITY':
        selected = this.affinity(job, eligible);
        break;
      case 'RANDOM':
        selected = eligible[Math.floor(Math.random() * eligible.length)];
        break;
      default:
        selected = this.leastLoaded(eligible);
    }

    log.debug('Worker selected', {
      jobId: job.id,
      workerId: selected.id,
      strategy: this.strategy,
      workerLoad: selected.currentJobCount / selected.maxConcurrency,
    });

    return selected;
  }

  private filterEligible(job: Job, workers: WorkerNode[]): WorkerNode[] {
    return workers.filter((w) => {
      if (!['ONLINE', 'BUSY'].includes(w.status)) return false;
      if (w.currentJobCount >= w.maxConcurrency) return false;
      if (!w.capabilities.jobTypes.includes(job.type) &&
          !w.capabilities.jobTypes.includes('CUSTOM')) return false;
      return true;
    });
  }

  private leastLoaded(workers: WorkerNode[]): WorkerNode {
    return workers.reduce((best, w) => {
      const loadA = best.currentJobCount / Math.max(best.maxConcurrency, 1);
      const loadB = w.currentJobCount / Math.max(w.maxConcurrency, 1);
      return loadB < loadA ? w : best;
    });
  }

  private roundRobin(workers: WorkerNode[]): WorkerNode {
    const idx = this.rrIndex % workers.length;
    this.rrIndex = (this.rrIndex + 1) % workers.length;
    return workers[idx];
  }

  private affinity(job: Job, workers: WorkerNode[]): WorkerNode {
    // Try to find a worker matching the job's metadata affinity hints
    const preferredRegion = job.metadata?.region as string | undefined;
    const requiredLabels = job.metadata?.requiredLabels as Record<string, string> | undefined;

    const affinityMatch = workers.filter((w) => {
      if (preferredRegion && w.capabilities.region !== preferredRegion) return false;
      if (requiredLabels) {
        for (const [k, v] of Object.entries(requiredLabels)) {
          if (w.capabilities.labels[k] !== v) return false;
        }
      }
      return true;
    });

    return affinityMatch.length > 0
      ? this.leastLoaded(affinityMatch)
      : this.leastLoaded(workers);
  }

  getStats(workers: WorkerNode[]): {
    totalCapacity: number;
    usedCapacity: number;
    utilizationPercent: number;
    eligibleWorkers: number;
  } {
    const onlineWorkers = workers.filter((w) => ['ONLINE', 'BUSY'].includes(w.status));
    const totalCapacity = onlineWorkers.reduce((s, w) => s + w.maxConcurrency, 0);
    const usedCapacity = onlineWorkers.reduce((s, w) => s + w.currentJobCount, 0);
    return {
      totalCapacity,
      usedCapacity,
      utilizationPercent: totalCapacity > 0 ? (usedCapacity / totalCapacity) * 100 : 0,
      eligibleWorkers: onlineWorkers.length,
    };
  }
}

export const loadBalancer = new LoadBalancer('LEAST_LOADED');
