import Knex from 'knex';
import { config } from '../utils/config';
import { createLogger } from '../utils/logger';

const log = createLogger('Database');

export const db = Knex({
  client: 'pg',
  connection: {
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
    ssl: config.app.isProduction ? { rejectUnauthorized: false } : false,
  },
  pool: {
    min: config.db.poolMin,
    max: config.db.poolMax,
    afterCreate(conn: { query: (sql: string, cb: (err: Error | null) => void) => void }, done: (err: Error | null, conn: unknown) => void) {
      conn.query('SET timezone = "UTC"', (err) => done(err, conn));
    },
  },
  acquireConnectionTimeout: 10_000,
  debug: config.app.isDevelopment,
});

export async function connectDatabase(): Promise<void> {
  try {
    await db.raw('SELECT 1');
    log.info('PostgreSQL connection established', {
      host: config.db.host,
      port: config.db.port,
      database: config.db.name,
    });
  } catch (error) {
    log.error('Failed to connect to PostgreSQL', { error });
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await db.destroy();
  log.info('PostgreSQL connection pool closed');
}

// Table name constants — avoids magic strings throughout the codebase
export const TABLES = {
  JOBS: 'jobs',
  WORKERS: 'workers',
  EXECUTION_LOGS: 'execution_logs',
  SCHEDULES: 'schedules',
  ORGANIZATIONS: 'organizations',
  USERS: 'users',
  API_KEYS: 'api_keys',
} as const;
