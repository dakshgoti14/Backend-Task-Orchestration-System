import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import cronParser from 'cron-parser';

dayjs.extend(utc);
dayjs.extend(timezone);

export function generateId(): string {
  return uuidv4();
}

/**
 * Calculate the next run time for a cron expression in a given timezone.
 */
export function getNextCronRun(expression: string, tz: string = 'UTC'): Date {
  const interval = cronParser.parseExpression(expression, {
    tz,
    currentDate: new Date(),
  });
  return interval.next().toDate();
}

/**
 * Compute retry delay with exponential backoff + optional jitter.
 */
export function computeRetryDelay(
  baseDelayMs: number,
  attempt: number,
  strategy: 'FIXED' | 'EXPONENTIAL' | 'JITTER',
): number {
  switch (strategy) {
    case 'FIXED':
      return baseDelayMs;
    case 'EXPONENTIAL':
      return Math.min(baseDelayMs * Math.pow(2, attempt - 1), 60_000); // cap at 60s
    case 'JITTER': {
      const exponential = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.random() * exponential * 0.2; // ±20% jitter
      return Math.min(exponential + jitter, 60_000);
    }
    default:
      return baseDelayMs;
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

/**
 * Deep-merge two objects (plain objects only).
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) &&
        tv && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      ) as T[keyof T];
    } else if (sv !== undefined) {
      result[key] = sv as T[keyof T];
    }
  }
  return result;
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate a string to a maximum length, appending '...' if truncated.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Safely parse a JSON string; returns null on failure.
 */
export function safeJsonParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/**
 * Sanitize error for safe transport (strip internal paths, trim stack).
 */
export function sanitizeError(err: unknown): { message: string; code?: string; stack?: string } {
  if (err instanceof Error) {
    return {
      message: err.message,
      code: (err as NodeJS.ErrnoException).code,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    };
  }
  return { message: String(err) };
}

/**
 * Chunk an array into subarrays of at most `size` elements.
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
