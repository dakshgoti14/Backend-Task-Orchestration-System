import { LoadBalancer } from '../../src/scheduler/LoadBalancer';
import { WorkerNode } from '../../src/models/Worker';
import { Job } from '../../src/models/Job';

function makeWorker(overrides: Partial<WorkerNode> = {}): WorkerNode {
  return {
    id: 'worker_' + Math.random().toString(36).slice(2),
    hostname: 'host1',
    ipAddress: '10.0.0.1',
    pid: 1234,
    version: '1.0.0',
    status: 'ONLINE',
    capabilities: {
      jobTypes: ['HTTP_REQUEST', 'CUSTOM'],
      maxConcurrency: 10,
      gpuEnabled: false,
      labels: {},
    },
    stats: {
      totalJobsProcessed: 0,
      totalJobsSucceeded: 0,
      totalJobsFailed: 0,
      totalJobsTimedOut: 0,
      averageJobDurationMs: 0,
      uptimeMs: 0,
      currentLoad: 0,
    },
    currentJobCount: 0,
    maxConcurrency: 10,
    lastHeartbeatAt: new Date(),
    registeredAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job1',
    name: 'test',
    type: 'HTTP_REQUEST',
    payload: {},
    status: 'PENDING',
    priority: 'MEDIUM',
    timezone: 'UTC',
    timeoutMs: 30000,
    retryConfig: { maxRetries: 3, retryDelay: 1000, retryBackoff: 'EXPONENTIAL', retryOn: [] },
    retryCount: 0,
    maxRetries: 3,
    dependencies: [],
    dependencyCount: 0,
    resolvedDependencyCount: 0,
    organizationId: 'org1',
    createdBy: 'user1',
    tags: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('LoadBalancer', () => {
  describe('LEAST_LOADED strategy', () => {
    const lb = new LoadBalancer('LEAST_LOADED');

    it('should return null when no workers are available', () => {
      expect(lb.selectWorker(makeJob(), [])).toBeNull();
    });

    it('should return null when all workers are at capacity', () => {
      const workers = [makeWorker({ currentJobCount: 10, maxConcurrency: 10 })];
      expect(lb.selectWorker(makeJob(), workers)).toBeNull();
    });

    it('should return null for offline workers', () => {
      const workers = [makeWorker({ status: 'OFFLINE' })];
      expect(lb.selectWorker(makeJob(), workers)).toBeNull();
    });

    it('should return null if worker does not support job type', () => {
      const workers = [makeWorker({ capabilities: { jobTypes: ['SHELL_COMMAND'], maxConcurrency: 10, gpuEnabled: false, labels: {} } })];
      expect(lb.selectWorker(makeJob({ type: 'HTTP_REQUEST' }), workers)).toBeNull();
    });

    it('should select the least loaded worker', () => {
      const workers = [
        makeWorker({ id: 'w1', currentJobCount: 8 }),
        makeWorker({ id: 'w2', currentJobCount: 2 }),
        makeWorker({ id: 'w3', currentJobCount: 5 }),
      ];
      const selected = lb.selectWorker(makeJob(), workers);
      expect(selected?.id).toBe('w2');
    });

    it('should accept BUSY workers with available capacity', () => {
      const workers = [makeWorker({ status: 'BUSY', currentJobCount: 5, maxConcurrency: 10 })];
      expect(lb.selectWorker(makeJob(), workers)).not.toBeNull();
    });
  });

  describe('ROUND_ROBIN strategy', () => {
    const lb = new LoadBalancer('ROUND_ROBIN');

    it('should cycle through workers', () => {
      const workers = [
        makeWorker({ id: 'w1' }),
        makeWorker({ id: 'w2' }),
        makeWorker({ id: 'w3' }),
      ];

      const selected1 = lb.selectWorker(makeJob(), workers);
      const selected2 = lb.selectWorker(makeJob(), workers);
      const selected3 = lb.selectWorker(makeJob(), workers);

      const ids = [selected1?.id, selected2?.id, selected3?.id];
      expect(new Set(ids).size).toBe(3); // all three different
    });
  });

  describe('getStats', () => {
    const lb = new LoadBalancer('LEAST_LOADED');

    it('should compute correct utilization', () => {
      const workers = [
        makeWorker({ status: 'ONLINE', maxConcurrency: 10, currentJobCount: 3 }),
        makeWorker({ status: 'BUSY',   maxConcurrency: 10, currentJobCount: 8 }),
      ];
      const stats = lb.getStats(workers);
      expect(stats.totalCapacity).toBe(20);
      expect(stats.usedCapacity).toBe(11);
      expect(stats.utilizationPercent).toBeCloseTo(55);
    });

    it('should report 0% utilization with no workers', () => {
      const stats = lb.getStats([]);
      expect(stats.utilizationPercent).toBe(0);
    });
  });
});
