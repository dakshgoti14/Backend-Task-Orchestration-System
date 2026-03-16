import {
  computeRetryDelay,
  formatDuration,
  deepMerge,
  chunkArray,
  truncate,
  safeJsonParse,
} from '../../src/utils/helpers';

describe('computeRetryDelay', () => {
  it('FIXED strategy always returns base delay', () => {
    expect(computeRetryDelay(5000, 1, 'FIXED')).toBe(5000);
    expect(computeRetryDelay(5000, 5, 'FIXED')).toBe(5000);
  });

  it('EXPONENTIAL doubles each attempt', () => {
    expect(computeRetryDelay(1000, 1, 'EXPONENTIAL')).toBe(1000);
    expect(computeRetryDelay(1000, 2, 'EXPONENTIAL')).toBe(2000);
    expect(computeRetryDelay(1000, 3, 'EXPONENTIAL')).toBe(4000);
  });

  it('EXPONENTIAL caps at 60s', () => {
    expect(computeRetryDelay(1000, 20, 'EXPONENTIAL')).toBe(60_000);
  });

  it('JITTER returns value within reasonable range', () => {
    const delay = computeRetryDelay(1000, 2, 'JITTER');
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(5500)).toBe('5.5s');
  });

  it('formats minutes', () => {
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('formats hours', () => {
    expect(formatDuration(3_720_000)).toBe('1h 2m');
  });
});

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const result = deepMerge({ a: 1, b: 2 } as Record<string, unknown>, { b: 3, c: 4 } as Record<string, unknown>);
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('deep-merges nested objects', () => {
    const result = deepMerge(
      { nested: { x: 1, y: 2 } } as Record<string, unknown>,
      { nested: { y: 99 } } as Record<string, unknown>,
    );
    expect(result).toEqual({ nested: { x: 1, y: 99 } });
  });

  it('does not mutate original', () => {
    const target = { a: 1 } as Record<string, unknown>;
    deepMerge(target, { b: 2 } as Record<string, unknown>);
    expect(target).toEqual({ a: 1 });
  });
});

describe('chunkArray', () => {
  it('splits into chunks of given size', () => {
    const chunks = chunkArray([1, 2, 3, 4, 5], 2);
    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('handles empty array', () => {
    expect(chunkArray([], 5)).toEqual([]);
  });

  it('handles chunk size larger than array', () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });
});

describe('truncate', () => {
  it('does not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long strings', () => {
    const result = truncate('hello world', 8);
    expect(result).toBe('hello...');
    expect(result.length).toBe(8);
  });
});

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for invalid JSON', () => {
    expect(safeJsonParse('not json')).toBeNull();
  });
});
