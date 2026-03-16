import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function optionalInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new Error(`Environment variable ${key} must be an integer`);
  return n;
}

function optionalBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return raw.toLowerCase() === 'true';
}

export const config = {
  app: {
    env: optional('NODE_ENV', 'development'),
    port: optionalInt('PORT', 3000),
    apiVersion: optional('API_VERSION', 'v1'),
    logLevel: optional('LOG_LEVEL', 'info'),
    isDevelopment: optional('NODE_ENV', 'development') === 'development',
    isProduction: optional('NODE_ENV', 'development') === 'production',
  },

  db: {
    host: optional('DB_HOST', 'localhost'),
    port: optionalInt('DB_PORT', 5432),
    name: optional('DB_NAME', 'task_orchestration'),
    user: optional('DB_USER', 'postgres'),
    password: optional('DB_PASSWORD', 'postgres'),
    poolMin: optionalInt('DB_POOL_MIN', 2),
    poolMax: optionalInt('DB_POOL_MAX', 20),
  },

  redis: {
    host: optional('REDIS_HOST', 'localhost'),
    port: optionalInt('REDIS_PORT', 6379),
    password: optional('REDIS_PASSWORD', ''),
    db: optionalInt('REDIS_DB', 0),
    keyPrefix: optional('REDIS_KEY_PREFIX', 'btos:'),
  },

  auth: {
    jwtSecret: optional('JWT_SECRET', 'dev-secret-change-in-production'),
    jwtExpiresIn: optional('JWT_EXPIRES_IN', '24h'),
    apiKeySaltRounds: optionalInt('API_KEY_SALT_ROUNDS', 12),
  },

  scheduler: {
    pollIntervalMs: optionalInt('SCHEDULER_POLL_INTERVAL_MS', 1000),
    maxConcurrentJobs: optionalInt('SCHEDULER_MAX_CONCURRENT_JOBS', 100),
    lockTtlMs: optionalInt('SCHEDULER_LOCK_TTL_MS', 30000),
    leaderElectionTtlMs: optionalInt('LEADER_ELECTION_TTL_MS', 10000),
  },

  worker: {
    concurrency: optionalInt('WORKER_CONCURRENCY', 10),
    maxRetries: optionalInt('WORKER_MAX_RETRIES', 3),
    retryDelayMs: optionalInt('WORKER_RETRY_DELAY_MS', 5000),
    jobTimeoutMs: optionalInt('WORKER_JOB_TIMEOUT_MS', 300000),
    heartbeatIntervalMs: optionalInt('WORKER_HEARTBEAT_INTERVAL_MS', 5000),
  },

  queue: {
    name: optional('QUEUE_NAME', 'job_queue'),
    deadLetterQueueName: optional('DEAD_LETTER_QUEUE_NAME', 'dlq'),
    maxDepth: optionalInt('MAX_QUEUE_DEPTH', 10000),
  },

  monitoring: {
    metricsPort: optionalInt('METRICS_PORT', 9090),
    metricsPath: optional('METRICS_PATH', '/metrics'),
    alertWebhookUrl: optional('ALERT_WEBHOOK_URL', ''),
  },

  rateLimit: {
    windowMs: optionalInt('RATE_LIMIT_WINDOW_MS', 60000),
    maxRequests: optionalInt('RATE_LIMIT_MAX_REQUESTS', 100),
  },
} as const;

export type Config = typeof config;
