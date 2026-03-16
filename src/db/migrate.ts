/**
 * Migration runner — reads SQL files from migrations/ and executes them
 * in order, tracking applied migrations in a knex_migrations table.
 *
 * Usage: npm run migrate
 */
import path from 'path';
import fs from 'fs';
import { db } from './index';
import { createLogger } from '../utils/logger';

const log = createLogger('Migrate');

async function ensureMigrationsTable(): Promise<void> {
  await db.schema.createTableIfNotExists('schema_migrations', (t) => {
    t.string('filename').primary();
    t.timestamp('applied_at').notNullable().defaultTo(db.fn.now());
  });
}

async function getAppliedMigrations(): Promise<string[]> {
  const rows = await db('schema_migrations').select('filename').orderBy('filename');
  return rows.map((r: { filename: string }) => r.filename);
}

async function runMigrations(): Promise<void> {
  log.info('Starting database migrations');

  await ensureMigrationsTable();
  const applied = new Set(await getAppliedMigrations());

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      log.info(`Skipping already-applied migration: ${file}`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    log.info(`Applying migration: ${file}`);

    await db.transaction(async (trx) => {
      await trx.raw(sql);
      await trx('schema_migrations').insert({ filename: file });
    });

    log.info(`Migration applied: ${file}`);
    ran++;
  }

  if (ran === 0) {
    log.info('All migrations already up to date');
  } else {
    log.info(`Applied ${ran} migration(s) successfully`);
  }
}

runMigrations()
  .then(() => {
    log.info('Migration complete');
    process.exit(0);
  })
  .catch((err) => {
    log.error('Migration failed', { error: err });
    process.exit(1);
  });
