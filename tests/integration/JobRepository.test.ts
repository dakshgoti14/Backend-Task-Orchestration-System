/**
 * Integration tests for JobRepository.
 * Requires a running PostgreSQL instance with migrations applied.
 *
 * Run: npm run test:integration
 * Environment: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */

import { JobRepository } from '../../src/db/repositories/JobRepository';
import { connectDatabase, disconnectDatabase, db, TABLES } from '../../src/db/index';
import { CreateJobDto } from '../../src/models/Job';

const repo = new JobRepository();

const ORG_ID = 'test-org-' + Date.now();
const USER_ID = 'test-user-1';

const sampleDto: CreateJobDto = {
  name: 'integration-test-job',
  type: 'HTTP_REQUEST',
  payload: { url: 'https://example.com', method: 'GET' },
  priority: 'HIGH',
  organizationId: ORG_ID,
  createdBy: USER_ID,
  tags: ['test', 'integration'],
};

// Skip if no DB available
const skipIfNoDb = process.env.DB_HOST ? describe : describe.skip;

skipIfNoDb('JobRepository (integration)', () => {
  beforeAll(async () => {
    await connectDatabase();
    // Seed a minimal organization row to satisfy FK constraint
    await db(TABLES.ORGANIZATIONS).insert({
      id: ORG_ID,
      name: `Test Org ${Date.now()}`,
      slug: `test-org-${Date.now()}`,
    }).onConflict('id').ignore();
  });

  afterAll(async () => {
    await db(TABLES.JOBS).where({ organization_id: ORG_ID }).delete();
    await db(TABLES.ORGANIZATIONS).where({ id: ORG_ID }).delete();
    await disconnectDatabase();
  });

  let createdJobId: string;

  it('should create a job', async () => {
    const job = await repo.create(sampleDto);
    expect(job.id).toBeDefined();
    expect(job.name).toBe('integration-test-job');
    expect(job.status).toBe('PENDING');
    expect(job.priority).toBe('HIGH');
    expect(job.organizationId).toBe(ORG_ID);
    expect(job.tags).toContain('test');
    createdJobId = job.id;
  });

  it('should find a job by ID', async () => {
    const job = await repo.findById(createdJobId);
    expect(job).not.toBeNull();
    expect(job?.id).toBe(createdJobId);
  });

  it('should return null for non-existent ID', async () => {
    const job = await repo.findById('00000000-0000-0000-0000-000000000000');
    expect(job).toBeNull();
  });

  it('should list jobs with organization filter', async () => {
    const result = await repo.findMany({ organizationId: ORG_ID, limit: 10, page: 1 });
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((j) => j.organizationId === ORG_ID)).toBe(true);
  });

  it('should update job status', async () => {
    const updated = await repo.update(createdJobId, { status: 'QUEUED' });
    expect(updated?.status).toBe('QUEUED');
  });

  it('should claim pending jobs atomically', async () => {
    // Reset to PENDING
    await repo.update(createdJobId, { status: 'PENDING' });

    const claimed = await repo.claimPendingJobs(10);
    expect(claimed.some((j) => j.id === createdJobId)).toBe(true);
    // Job should now be QUEUED
    const refetched = await repo.findById(createdJobId);
    expect(refetched?.status).toBe('QUEUED');
  });

  it('should paginate results', async () => {
    // Create 5 more jobs
    for (let i = 0; i < 5; i++) {
      await repo.create({ ...sampleDto, name: `paginate-test-${i}` });
    }

    const page1 = await repo.findMany({ organizationId: ORG_ID, page: 1, limit: 3 });
    const page2 = await repo.findMany({ organizationId: ORG_ID, page: 2, limit: 3 });

    expect(page1.data.length).toBe(3);
    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);
    // No overlap
    const p1ids = page1.data.map((j) => j.id);
    const p2ids = page2.data.map((j) => j.id);
    const overlap = p1ids.filter((id) => p2ids.includes(id));
    expect(overlap.length).toBe(0);
  });
});
