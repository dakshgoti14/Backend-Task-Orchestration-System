# System Architecture

## Overview

The Backend Task Orchestration System is a horizontally scalable, fault-tolerant distributed job scheduler. It decouples job submission from job execution using an async message queue and implements leader election to prevent duplicate scheduling.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                     │
│                                                                      │
│   Web Dashboard  │  CLI  │  External Services (via REST/GraphQL)    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
┌──────────────────────────────▼──────────────────────────────────────┐
│                       API GATEWAY LAYER                              │
│                                                                      │
│  ┌───────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Helmet   │  │ Rate Limiter │  │   CORS   │  │  Compression  │  │
│  └───────────┘  └──────────────┘  └──────────┘  └───────────────┘  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │             Express.js + Apollo GraphQL Server              │    │
│  │                                                             │    │
│  │  POST /jobs  GET /jobs  PATCH /jobs/:id/cancel  /metrics   │    │
│  │  /health     /schedules /workers   /graphql                │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┴──────────────────┐
              │                                   │
┌─────────────▼───────────────┐  ┌───────────────▼───────────────────┐
│      SERVICE LAYER          │  │      SCHEDULER ENGINE              │
│                             │  │                                    │
│  ┌──────────────────────┐   │  │  ┌──────────────────────────────┐ │
│  │  JobService          │   │  │  │  JobScheduler (Leader)       │ │
│  │  WorkerService       │   │  │  │  - claimPendingJobs()         │ │
│  │  RetryService        │   │  │  │  - scheduleReadyJobs()        │ │
│  │  NotificationService │   │  │  │  - recoverStalledJobs()       │ │
│  └──────────────────────┘   │  │  └──────────────────────────────┘ │
└─────────────────────────────┘  │                                    │
                                  │  ┌──────────────────────────────┐ │
                                  │  │  CronScheduler               │ │
                                  │  │  PriorityQueue (min-heap)    │ │
                                  │  │  DependencyResolver (DAG)    │ │
                                  │  │  LoadBalancer                │ │
                                  │  └──────────────────────────────┘ │
                                  └───────────────┬────────────────────┘
                                                  │
┌─────────────────────────────────────────────────▼──────────────────┐
│                    MESSAGE BROKER (Redis + BullMQ)                   │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  job_queue (priority queued, BullMQ sorted sets)           │     │
│  │  dead_letter_queue (permanently failed jobs)               │     │
│  │  scheduler:leader (distributed lock)                       │     │
│  │  btos:nodes:* (node registry — TTL-based)                  │     │
│  └────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────┘
         │                             │
┌────────▼──────────┐      ┌───────────▼────────────────────────────┐
│  WORKER POOL      │      │         DATA LAYER                      │
│                   │      │                                         │
│  ┌─────────────┐  │      │  ┌──────────────────────────────────┐  │
│  │  Worker 1   │  │      │  │  PostgreSQL                       │  │
│  │  Worker 2   │  │      │  │  - jobs (with runnable-jobs idx)  │  │
│  │  Worker 3   │  │      │  │  - execution_logs (append-only)  │  │
│  │  ...        │  │      │  │  - workers, schedules, orgs       │  │
│  │  Worker N   │  │      │  └──────────────────────────────────┘  │
│  └─────────────┘  │      │                                         │
│                   │      │  ┌──────────────────────────────────┐  │
│  Each worker:     │      │  │  Redis                            │  │
│  - BullMQ Worker  │      │  │  - BullMQ job data               │  │
│  - JobExecutor    │      │  │  - Distributed locks             │  │
│  - DB heartbeat   │      │  │  - Node registry (TTL keys)      │  │
└───────────────────┘      │  └──────────────────────────────────┘  │
                            └─────────────────────────────────────────┘
```

---

## Data Flow: Job Submission to Completion

```
Client
  │
  │  1. POST /api/v1/jobs
  ▼
API Layer
  │  2. Validates request (Joi), checks auth (JWT/ApiKey)
  │  3. Calls JobService.createJob()
  ▼
JobService
  │  4. Validates cron expression, dependency job existence
  │  5. Calls jobScheduler.submitJob()
  ▼
JobScheduler
  │  6. Calls jobRepository.create() — writes PENDING row to DB
  │  7. Registers job in DependencyResolver
  │  8. Returns job to caller (async — not yet in queue)
  ▼
DB (PostgreSQL): jobs row, status=PENDING

--- [Scheduler poll tick, every 1000ms] ---

JobScheduler.scheduleReadyJobs()
  │  9. claimPendingJobs(): SELECT FOR UPDATE SKIP LOCKED
  │     → atomically marks eligible jobs as QUEUED
  │  10. For each claimed job: jobQueue.add() with priority + delay
  ▼
Redis/BullMQ: job added to sorted set

--- [Worker processes] ---

WorkerNode (BullMQ Worker)
  │  11. Picks up job from queue
  │  12. Creates ExecutionLog row (status=RUNNING)
  │  13. Updates job row (status=RUNNING, workerId, startedAt)
  │  14. Calls jobExecutor.execute() — runs job with timeout
  ▼
JobExecutor
  │  15. Dispatches to handler (HTTP/shell/webhook/etc)
  │  16. Returns ExecutionResult {success, result, durationMs}
  ▼
WorkerNode
  │  17a. Success: updates job (COMPLETED, result) + executionLog (COMPLETED)
  │  17b. Failure + retries remain: RETRYING, schedules retry via BullMQ backoff
  │  17c. Failure + no retries: FAILED + DLQ entry
  │  18. Calls jobScheduler.onJobCompleted() → DependencyResolver.onJobStateChange()
  │  19. DependencyResolver emits 'jobs:unblocked' for waiting dependents
  ▼
Client can poll GET /jobs/:id or use webhooks/notifications
```

---

## Distributed Leader Election

```
Startup (multiple scheduler instances):

Instance A                    Instance B                    Instance C
    │                             │                             │
    │  SET scheduler:leader       │                             │
    │  token_A NX PX 10000        │                             │
    │  ◄──── OK ─────────────     │                             │
    │                             │  SET scheduler:leader       │
    │  ACQUIRED LEADER            │  token_B NX PX 10000        │
    │                             │  ◄──── NIL ──────────────── │
    │                             │  (lock taken by A)          │
    │                             │  FOLLOWER                   │
    │                             │                             │
    │  [5s renewal interval]      │  [polls every 8s]           │
    │  PEXPIRE 10000              │                             │
    │                             │                             │
    │  [crash / network partition]│                             │
    │  ✗ renewal fails            │                             │
    │  [10s TTL expires]          │                             │
    │                             │  SET scheduler:leader       │
    │                             │  token_B NX PX 10000        │
    │                             │  ◄──── OK ──────────────    │
    │                             │  NEW LEADER                 │
```

---

## Retry Logic State Machine

```
                     ┌───────────┐
         submit      │           │       schedule
         ─────────►  │  PENDING  │  ──────────────►  QUEUED
                     │           │
                     └───────────┘
                                          │
                                          │ worker picks up
                                          ▼
                                       RUNNING
                                      /       \
                           success   /         \  failure
                                    /           \
                               COMPLETED      FAILED
                                              /    \
                              retries remain /      \ retries exhausted
                                            /        \
                                        RETRYING    FAILED (final)
                                            │              │
                                            │              ▼
                             re-queued      │             DLQ
                      ◄────────────────────┘
```

---

## Database Schema Summary

```sql
organizations (id, name, slug, plan, is_active)
  └── users (id, org_id, email, role)
       └── api_keys (id, user_id, key_hash, scopes)

jobs (
  id, name, type, payload, status, priority,
  scheduled_at, cron_expression, timezone, next_run_at,
  worker_id, started_at, completed_at, timeout_ms,
  retry_config JSONB, retry_count, max_retries,
  dependencies JSONB, dependency_count, resolved_dependency_count,
  result JSONB, error_message, error_stack,
  organization_id, created_by, tags[], metadata JSONB
)

schedules (id, name, cron_expression, timezone, job_template JSONB, is_active, next_trigger_at)

workers (id, hostname, ip, pid, status, capabilities JSONB, stats JSONB, current_job_count)

execution_logs (id, job_id, worker_id, attempt_number, status, started_at, duration_ms, result JSONB)
              ^-- append-only: no UPDATE trigger
```

---

## Performance Characteristics

| Operation | Expected Throughput | Notes |
|---|---|---|
| Job submission (API) | ~5,000 req/s | Stateless Express, limited by DB write |
| Job scheduling (poll) | 50 jobs/poll at 1s interval | FOR UPDATE SKIP LOCKED prevents contention |
| Job execution | 100 concurrent/node | Limited by WORKER_CONCURRENCY |
| Queue depth | Up to 10M jobs | Redis sorted set — O(log N) per op |
| PriorityQueue ops | 100K inserts/sec | In-memory min-heap — O(log N) |

---

## Scaling Strategy

**Horizontal scaling:**
- API nodes: stateless, add unlimited instances behind a load balancer
- Worker nodes: each independently connects to Redis queue; add pods for throughput
- Scheduler: only one is active (leader election); others are hot standby

**Vertical scaling:**
- PostgreSQL: increase connection pool size (DB_POOL_MAX), add read replicas
- Redis: increase maxmemory, use Redis Cluster for very high throughput

**Bottlenecks to watch:**
1. PostgreSQL write throughput for job status updates
2. Redis memory for BullMQ job data (mitigated by removeOnComplete TTL)
3. Worker CPU for CPU-intensive job types (use dedicated worker pools)
