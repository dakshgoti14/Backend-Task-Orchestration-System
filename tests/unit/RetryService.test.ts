import { RetryService } from '../../src/services/RetryService';
import { Job } from '../../src/models/Job';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    name: 'test',
    type: 'HTTP_REQUEST',
    payload: {},
    status: 'FAILED',
    priority: 'MEDIUM',
    timezone: 'UTC',
    timeoutMs: 30000,
    retryConfig: {
      maxRetries: 3,
      retryDelay: 1000,
      retryBackoff: 'EXPONENTIAL',
      retryOn: [],
    },
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

describe('RetryService', () => {
  const service = new RetryService();

  describe('shouldRetry', () => {
    it('returns true when retries remain and no restrictions', () => {
      const job = makeJob({ retryCount: 0, maxRetries: 3 });
      expect(service.shouldRetry(job)).toBe(true);
    });

    it('returns false when retries exhausted', () => {
      const job = makeJob({ retryCount: 3, maxRetries: 3 });
      expect(service.shouldRetry(job)).toBe(false);
    });

    it('returns false for permanent error codes', () => {
      const job = makeJob({ retryCount: 0, maxRetries: 3 });
      expect(service.shouldRetry(job, 'SECURITY_VIOLATION')).toBe(false);
      expect(service.shouldRetry(job, 'HANDLER_NOT_FOUND')).toBe(false);
      expect(service.shouldRetry(job, 'UNKNOWN_JOB_TYPE')).toBe(false);
    });

    it('returns true for non-permanent error codes', () => {
      const job = makeJob({ retryCount: 0, maxRetries: 3 });
      expect(service.shouldRetry(job, 'HTTP_ERROR')).toBe(true);
      expect(service.shouldRetry(job, 'NETWORK_TIMEOUT')).toBe(true);
    });

    it('respects retryOn whitelist', () => {
      const job = makeJob({
        retryCount: 0,
        maxRetries: 3,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          retryBackoff: 'FIXED',
          retryOn: ['HTTP_ERROR'],
        },
      });

      expect(service.shouldRetry(job, 'HTTP_ERROR')).toBe(true);
      expect(service.shouldRetry(job, 'SHELL_ERROR')).toBe(false);
      expect(service.shouldRetry(job)).toBe(false); // no error code provided
    });
  });

  describe('getRetryDelay', () => {
    it('computes EXPONENTIAL backoff', () => {
      const job = makeJob({
        retryCount: 1,
        retryConfig: { maxRetries: 3, retryDelay: 1000, retryBackoff: 'EXPONENTIAL', retryOn: [] },
      });
      // attempt = retryCount + 1 = 2 → 1000 * 2^(2-1) = 2000
      expect(service.getRetryDelay(job)).toBe(2000);
    });

    it('returns fixed delay for FIXED strategy', () => {
      const job = makeJob({
        retryCount: 5,
        retryConfig: { maxRetries: 10, retryDelay: 5000, retryBackoff: 'FIXED', retryOn: [] },
      });
      expect(service.getRetryDelay(job)).toBe(5000);
    });
  });
});
