import { PriorityQueue, PriorityItem } from '../../src/scheduler/PriorityQueue';

describe('PriorityQueue', () => {
  let pq: PriorityQueue<string>;

  beforeEach(() => {
    pq = new PriorityQueue<string>();
  });

  describe('basic operations', () => {
    it('should be empty on creation', () => {
      expect(pq.size).toBe(0);
      expect(pq.isEmpty).toBe(true);
    });

    it('should return undefined when popping from empty queue', () => {
      expect(pq.pop()).toBeUndefined();
    });

    it('should return undefined when peeking empty queue', () => {
      expect(pq.peek()).toBeUndefined();
    });

    it('should increase size on push', () => {
      pq.push({ score: 1, scheduledAt: 0, createdAt: 0, data: 'job1' });
      expect(pq.size).toBe(1);
      expect(pq.isEmpty).toBe(false);
    });

    it('should clear all items', () => {
      pq.push({ score: 1, scheduledAt: 0, createdAt: 0, data: 'job1' });
      pq.push({ score: 2, scheduledAt: 0, createdAt: 0, data: 'job2' });
      pq.clear();
      expect(pq.size).toBe(0);
    });
  });

  describe('priority ordering', () => {
    it('should always pop the item with lowest score first', () => {
      pq.push({ score: 3, scheduledAt: 0, createdAt: 0, data: 'low' });
      pq.push({ score: 1, scheduledAt: 0, createdAt: 0, data: 'critical' });
      pq.push({ score: 2, scheduledAt: 0, createdAt: 0, data: 'medium' });

      expect(pq.pop()?.data).toBe('critical');
      expect(pq.pop()?.data).toBe('medium');
      expect(pq.pop()?.data).toBe('low');
    });

    it('should break ties by scheduledAt ascending', () => {
      const now = Date.now();
      pq.push({ score: 1, scheduledAt: now + 2000, createdAt: 0, data: 'later' });
      pq.push({ score: 1, scheduledAt: now + 1000, createdAt: 0, data: 'sooner' });

      expect(pq.pop()?.data).toBe('sooner');
      expect(pq.pop()?.data).toBe('later');
    });

    it('should break secondary ties by createdAt ascending', () => {
      const now = Date.now();
      pq.push({ score: 1, scheduledAt: now, createdAt: 200, data: 'newer' });
      pq.push({ score: 1, scheduledAt: now, createdAt: 100, data: 'older' });

      expect(pq.pop()?.data).toBe('older');
      expect(pq.pop()?.data).toBe('newer');
    });
  });

  describe('heap invariant', () => {
    it('should maintain min-heap property with 100 random insertions', () => {
      const scores: number[] = [];
      for (let i = 0; i < 100; i++) {
        const score = Math.floor(Math.random() * 100);
        scores.push(score);
        pq.push({ score, scheduledAt: 0, createdAt: 0, data: `job_${i}` });
      }

      let prevScore = -Infinity;
      while (!pq.isEmpty) {
        const item = pq.pop()!;
        expect(item.score).toBeGreaterThanOrEqual(prevScore);
        prevScore = item.score;
      }
    });
  });

  describe('peek', () => {
    it('should peek without removing', () => {
      pq.push({ score: 1, scheduledAt: 0, createdAt: 0, data: 'only' });
      const peeked = pq.peek();
      expect(peeked?.data).toBe('only');
      expect(pq.size).toBe(1);
    });
  });

  describe('toArray', () => {
    it('should return items in sorted order', () => {
      pq.push({ score: 3, scheduledAt: 0, createdAt: 0, data: 'c' });
      pq.push({ score: 1, scheduledAt: 0, createdAt: 0, data: 'a' });
      pq.push({ score: 2, scheduledAt: 0, createdAt: 0, data: 'b' });

      const arr = pq.toArray();
      expect(arr.map(i => i.data)).toEqual(['a', 'b', 'c']);
    });
  });
});
