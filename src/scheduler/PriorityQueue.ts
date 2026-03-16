/**
 * PriorityQueue — generic min-heap implementation.
 *
 * Used by the in-memory scheduler for O(log n) job insertion and
 * O(log n) extraction of the highest-priority job.
 *
 * Priority ordering (lower score = higher priority):
 *   CRITICAL(1) < HIGH(2) < MEDIUM(3) < LOW(4) < BACKGROUND(5)
 *   With ties broken by scheduledAt ASC, then createdAt ASC.
 */

export interface PriorityItem<T> {
  score: number;       // lower = higher priority
  scheduledAt: number; // unix ms, for tie-breaking
  createdAt: number;   // unix ms, secondary tie-break
  data: T;
}

export class PriorityQueue<T> {
  private heap: PriorityItem<T>[] = [];

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  push(item: PriorityItem<T>): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): PriorityItem<T> | undefined {
    if (this.isEmpty) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): PriorityItem<T> | undefined {
    return this.heap[0];
  }

  toArray(): PriorityItem<T>[] {
    return [...this.heap].sort(this.compareFn);
  }

  clear(): void {
    this.heap = [];
  }

  private compareFn(a: PriorityItem<T>, b: PriorityItem<T>): number {
    if (a.score !== b.score) return a.score - b.score;
    if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt - b.scheduledAt;
    return a.createdAt - b.createdAt;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this.compareFn(this.heap[idx], this.heap[parentIdx]) < 0) {
        [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
        idx = parentIdx;
      } else break;
    }
  }

  private sinkDown(idx: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      if (left < n && this.compareFn(this.heap[left], this.heap[smallest]) < 0)
        smallest = left;
      if (right < n && this.compareFn(this.heap[right], this.heap[smallest]) < 0)
        smallest = right;

      if (smallest !== idx) {
        [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
        idx = smallest;
      } else break;
    }
  }
}
