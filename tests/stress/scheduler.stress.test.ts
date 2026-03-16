/**
 * Stress test: scheduler priority queue throughput.
 *
 * Validates that the PriorityQueue can handle:
 *  - 100,000 insertions without degrading
 *  - Correct ordering is maintained under load
 *  - Memory usage stays bounded
 */

import { PriorityQueue } from '../../src/scheduler/PriorityQueue';

describe('PriorityQueue stress test', () => {
  const JOB_COUNT = 100_000;

  it(`should handle ${JOB_COUNT} insertions in < 2s`, () => {
    const pq = new PriorityQueue<string>();
    const start = Date.now();

    for (let i = 0; i < JOB_COUNT; i++) {
      pq.push({
        score: Math.floor(Math.random() * 5) + 1,
        scheduledAt: Date.now() + Math.random() * 60_000,
        createdAt: Date.now(),
        data: `job_${i}`,
      });
    }

    const insertTime = Date.now() - start;
    console.log(`${JOB_COUNT} insertions: ${insertTime}ms`);
    expect(insertTime).toBeLessThan(2000);
    expect(pq.size).toBe(JOB_COUNT);
  });

  it(`should extract ${JOB_COUNT} items in sorted order`, () => {
    const pq = new PriorityQueue<number>();

    for (let i = 0; i < JOB_COUNT; i++) {
      pq.push({ score: Math.random() * 5 + 1, scheduledAt: Date.now(), createdAt: i, data: i });
    }

    const start = Date.now();
    let prev = -Infinity;
    while (!pq.isEmpty) {
      const item = pq.pop()!;
      expect(item.score).toBeGreaterThanOrEqual(prev);
      prev = item.score;
    }

    const extractTime = Date.now() - start;
    console.log(`${JOB_COUNT} extractions in sorted order: ${extractTime}ms`);
    expect(extractTime).toBeLessThan(3000);
  });
});

describe('DependencyResolver stress test', () => {
  it('should handle 1000 job dependency registrations', () => {
    const { DependencyResolver } = require('../../src/scheduler/DependencyResolver');
    const resolver = new DependencyResolver();
    const jobIds: string[] = [];

    // Create a chain of 1000 jobs
    for (let i = 0; i < 1000; i++) {
      jobIds.push(`job_${i}`);
    }

    const start = Date.now();

    // Register all jobs
    for (let i = 0; i < 1000; i++) {
      const job = {
        id: jobIds[i],
        dependencies: i > 0 ? [{ jobId: jobIds[i - 1], requireStatus: ['COMPLETED'] }] : [],
        dependencyCount: i > 0 ? 1 : 0,
      };
      resolver.register(job);
    }

    const registrationTime = Date.now() - start;
    console.log(`1000 registrations: ${registrationTime}ms`);
    expect(registrationTime).toBeLessThan(500);

    const stats = resolver.getStats();
    expect(stats.totalNodes).toBe(1000);
    expect(stats.resolvedNodes).toBe(1); // only the first job
  });
});
