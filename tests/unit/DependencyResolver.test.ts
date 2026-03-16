import { DependencyResolver } from '../../src/scheduler/DependencyResolver';
import { Job } from '../../src/models/Job';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job_' + Math.random().toString(36).slice(2),
    name: 'test-job',
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

describe('DependencyResolver', () => {
  let resolver: DependencyResolver;

  beforeEach(() => {
    resolver = new DependencyResolver();
  });

  describe('register', () => {
    it('should register a job with no dependencies as resolved', () => {
      const job = makeJob({ dependencies: [], dependencyCount: 0 });
      resolver.register(job);
      expect(resolver.isResolved(job.id)).toBe(true);
    });

    it('should register a job with dependencies as unresolved', () => {
      const dep = makeJob();
      const job = makeJob({
        dependencies: [{ jobId: dep.id, requireStatus: ['COMPLETED'] }],
        dependencyCount: 1,
      });
      resolver.register(job);
      expect(resolver.isResolved(job.id)).toBe(false);
    });
  });

  describe('onJobStateChange', () => {
    it('should unblock a dependent job when its dependency completes', () => {
      const dep = makeJob();
      const child = makeJob({
        dependencies: [{ jobId: dep.id, requireStatus: ['COMPLETED'] }],
        dependencyCount: 1,
      });

      resolver.register(dep);
      resolver.register(child);
      expect(resolver.isResolved(child.id)).toBe(false);

      const unblocked = resolver.onJobStateChange(dep.id, 'COMPLETED');
      expect(unblocked).toContain(child.id);
      expect(resolver.isResolved(child.id)).toBe(true);
    });

    it('should not unblock if status does not match requirement', () => {
      const dep = makeJob();
      const child = makeJob({
        dependencies: [{ jobId: dep.id, requireStatus: ['COMPLETED'] }],
        dependencyCount: 1,
      });

      resolver.register(dep);
      resolver.register(child);

      const unblocked = resolver.onJobStateChange(dep.id, 'FAILED');
      expect(unblocked).not.toContain(child.id);
      expect(resolver.isResolved(child.id)).toBe(false);
    });

    it('should handle a chain: A → B → C', () => {
      const a = makeJob();
      const b = makeJob({ dependencies: [{ jobId: a.id, requireStatus: ['COMPLETED'] }], dependencyCount: 1 });
      const c = makeJob({ dependencies: [{ jobId: b.id, requireStatus: ['COMPLETED'] }], dependencyCount: 1 });

      resolver.register(a);
      resolver.register(b);
      resolver.register(c);

      expect(resolver.isResolved(b.id)).toBe(false);
      expect(resolver.isResolved(c.id)).toBe(false);

      resolver.onJobStateChange(a.id, 'COMPLETED');
      expect(resolver.isResolved(b.id)).toBe(true);
      expect(resolver.isResolved(c.id)).toBe(false); // c depends on b, not a

      resolver.onJobStateChange(b.id, 'COMPLETED');
      expect(resolver.isResolved(c.id)).toBe(true);
    });

    it('should emit jobs:unblocked event', (done) => {
      const dep = makeJob();
      const child = makeJob({
        dependencies: [{ jobId: dep.id, requireStatus: ['COMPLETED'] }],
        dependencyCount: 1,
      });

      resolver.register(dep);
      resolver.register(child);

      resolver.on('jobs:unblocked', (ids: string[]) => {
        expect(ids).toContain(child.id);
        done();
      });

      resolver.onJobStateChange(dep.id, 'COMPLETED');
    });
  });

  describe('validateNoCycles', () => {
    it('should throw on circular dependency', () => {
      const a = makeJob();
      const b = makeJob({ dependencies: [{ jobId: a.id, requireStatus: ['COMPLETED'] }] });

      // Create circular: a depends on b, b depends on a
      a.dependencies = [{ jobId: b.id, requireStatus: ['COMPLETED'] }];

      resolver.register(a);
      resolver.register(b);

      expect(() => resolver.validateNoCycles([a.id, b.id])).toThrow(/Circular dependency/);
    });

    it('should not throw for valid DAG', () => {
      const a = makeJob();
      const b = makeJob({ dependencies: [{ jobId: a.id, requireStatus: ['COMPLETED'] }] });

      resolver.register(a);
      resolver.register(b);

      expect(() => resolver.validateNoCycles([a.id, b.id])).not.toThrow();
    });
  });

  describe('topologicalSort', () => {
    it('should order jobs so dependencies come first', () => {
      const a = makeJob();
      const b = makeJob({ dependencies: [{ jobId: a.id, requireStatus: ['COMPLETED'] }] });

      resolver.register(a);
      resolver.register(b);

      const sorted = resolver.topologicalSort([b.id, a.id]);
      const aIdx = sorted.indexOf(a.id);
      const bIdx = sorted.indexOf(b.id);
      expect(aIdx).toBeLessThan(bIdx);
    });
  });

  describe('getStats', () => {
    it('should report correct node counts', () => {
      const a = makeJob();
      const b = makeJob({ dependencies: [{ jobId: a.id, requireStatus: ['COMPLETED'] }] });
      resolver.register(a);
      resolver.register(b);

      const stats = resolver.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.resolvedNodes).toBe(1); // only 'a'
      expect(stats.pendingNodes).toBe(1);  // only 'b'
    });
  });
});
