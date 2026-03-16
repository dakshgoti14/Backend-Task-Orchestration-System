# Backend Task Orchestration System

A production-grade **Distributed Job Scheduling Platform** built with Node.js/TypeScript, PostgreSQL, Redis, and BullMQ. Designed for high-throughput, fault-tolerant, priority-aware job orchestration across horizontally-scaled worker nodes.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Testing](#testing)
- [Monitoring](#monitoring)

---

## Overview

Modern distributed applications require reliable job scheduling at scale — processing millions of background tasks, handling retries on failure, respecting inter-job dependencies, and providing deep observability. This platform provides all of that through a clean API, without sacrificing performance or reliability.

**Problems Solved:**
- Unreliable one-off background tasks with no retry semantics
- No visibility into job state, history, or failure reasons
- Single-node bottlenecks in job execution
- Race conditions from multiple scheduler instances
- No dependency management between related jobs

---

## Architecture

```
                     ┌─────────────────────────────────────────────────────┐
                     │              CLIENT LAYER                           │
                     │   REST API  │  GraphQL API  │  CLI / SDK           │
                     └────────────────────┬────────────────────────────────┘
                                          │  HTTPS
                     ┌────────────────────▼────────────────────────────────┐
                     │              API GATEWAY                            │
                     │   Auth  │  Rate Limit  │  Validation  │  CORS      │
                     └────────────────────┬────────────────────────────────┘
                                          │
              ┌───────────────────────────▼────────────────────────────────┐
              │                   SERVICE LAYER                            │
              │  JobService  │  WorkerService  │  RetryService  │  Notif  │
              └──────┬─────────────────────────────────────┬───────────────┘
                     │                                     │
     ┌───────────────▼──────────┐         ┌───────────────▼───────────────┐
     │      SCHEDULER ENGINE    │         │        WORKER POOL             │
     │  ┌───────────────────┐   │         │  ┌────────┐ ┌────────┐        │
     │  │  Priority Queue   │   │         │  │Worker 1│ │Worker 2│  ...   │
     │  │  Cron Scheduler   │   │         │  └────┬───┘ └───┬────┘        │
     │  │  Dep. Resolver    │   │         │       │         │              │
     │  │  Load Balancer    │   │         └───────┼─────────┼──────────────┘
     │  └───────────────────┘   │                 │         │
     └──────────────────────────┘                 │         │
                     │                            │         │
     ┌───────────────▼────────────────────────────▼─────────▼──────────────┐
     │                     MESSAGE BROKER (Redis / BullMQ)                  │
     │   job_queue  │  priority_queue  │  dead_letter_queue  │  events      │
     └──────────────────────────────────────────────────────┬───────────────┘
                                                            │
     ┌──────────────────────────────────────────────────────▼───────────────┐
     │                     DATA LAYER                                        │
     │   PostgreSQL (job metadata, logs, history)  │  Redis (cache, locks)  │
     └───────────────────────────────────────────────────────────────────────┘
                     │
     ┌───────────────▼──────────────────────────────────────────────────────┐
     │                  OBSERVABILITY LAYER                                  │
     │   Prometheus Metrics  │  Winston Logs  │  AlertManager  │  Grafana   │
     └───────────────────────────────────────────────────────────────────────┘
```

### Distributed Coordination

```
  Node A (Leader)          Node B (Follower)        Node C (Follower)
  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
  │  Scheduler   │◄────────│  Standby     │◄────────│  Standby     │
  │  (Active)    │         │  Scheduler   │         │  Scheduler   │
  │              │         │              │         │              │
  │  Redis Lock  │         │  Heartbeat   │         │  Heartbeat   │
  └──────┬───────┘         └──────────────┘         └──────────────┘
         │
         │  Distributes jobs via BullMQ
         ▼
  ┌──────────────────────────────────────────┐
  │              Worker Pool                  │
  │  W1  W2  W3  W4  W5  W6  W7  W8  W9  W10│
  └──────────────────────────────────────────┘
```

---

## Features

| Feature | Description |
|---|---|
| **Job Submission** | REST/GraphQL API to submit one-off or recurring jobs |
| **Priority Scheduling** | 5-level priority queue (CRITICAL → LOW) |
| **Cron Scheduling** | Full cron expression support with timezone awareness |
| **Dependency Graphs** | DAG-based job dependency resolution |
| **Retry Logic** | Exponential backoff, configurable max retries, jitter |
| **Dead Letter Queue** | Permanently failed jobs stored for inspection/replay |
| **Worker Autoscaling** | Dynamic worker pool scaling based on queue depth |
| **Distributed Locks** | Redlock-based distributed mutual exclusion |
| **Leader Election** | Automatic leader election across scheduler instances |
| **Fault Tolerance** | Node failure detection, job requeuing, health checks |
| **Monitoring** | Prometheus metrics, Grafana dashboards, alerting |
| **Job History** | Full execution log with duration, output, error traces |
| **Rate Limiting** | Per-API-key rate limiting at the gateway |
| **Multi-tenancy** | Organization-scoped jobs and worker isolation |
| **Horizontal Scaling** | Stateless API + worker nodes, infinite scale-out |

---

## Technology Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 20 LTS |
| **Language** | TypeScript 5.3 |
| **API Framework** | Express.js 4 + Apollo GraphQL 3 |
| **Job Queue** | BullMQ 5 (Redis-backed) |
| **Cache / Locks** | Redis 7 + ioredis + Redlock |
| **Database** | PostgreSQL 16 + Knex.js |
| **Authentication** | JWT + API Keys (bcrypt hashed) |
| **Logging** | Winston (structured JSON logs) |
| **Metrics** | prom-client (Prometheus) |
| **Scheduling** | node-cron + cron-parser |
| **Containerization** | Docker + Docker Compose |
| **Orchestration** | Kubernetes (manifests included) |
| **CI/CD** | GitHub Actions |
| **Testing** | Jest + Supertest |

---

## Project Structure

```
Backend-Task-Orchestration-System/
├── .github/workflows/          # CI/CD pipelines
├── src/
│   ├── api/                    # REST routes, GraphQL, middleware
│   │   ├── routes/             # Express route handlers
│   │   ├── middleware/         # Auth, rate-limit, validation
│   │   └── graphql/            # Schema + resolvers
│   ├── scheduler/              # Core scheduling engine
│   │   ├── JobScheduler.ts     # Main orchestrator
│   │   ├── CronScheduler.ts    # Cron expression handler
│   │   ├── PriorityQueue.ts    # Min-heap priority queue
│   │   ├── DependencyResolver.ts # DAG resolver
│   │   └── LoadBalancer.ts     # Worker load balancing
│   ├── workers/                # Job execution layer
│   │   ├── WorkerNode.ts       # Individual worker process
│   │   ├── WorkerPool.ts       # Worker lifecycle manager
│   │   └── JobExecutor.ts      # Job runner + timeout handler
│   ├── queue/                  # BullMQ queue abstractions
│   │   ├── JobQueue.ts
│   │   ├── DeadLetterQueue.ts
│   │   └── QueueManager.ts
│   ├── db/                     # Data access layer
│   │   ├── index.ts            # Knex connection + pool
│   │   ├── migrate.ts          # Migration runner
│   │   ├── seed.ts             # Seed data
│   │   ├── migrations/         # SQL migration files
│   │   └── repositories/       # Repository pattern
│   ├── models/                 # TypeScript interfaces/types
│   ├── services/               # Business logic services
│   ├── distributed/            # Distributed systems primitives
│   ├── monitoring/             # Metrics, alerts, health checks
│   ├── utils/                  # Logger, config, helpers
│   └── app.ts                  # Express app + startup
├── tests/
│   ├── unit/                   # Isolated unit tests
│   ├── integration/            # DB/Redis integration tests
│   └── stress/                 # Load and stress tests
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── k8s/                        # Kubernetes manifests
├── monitoring/                 # Prometheus + Grafana config
├── docs/                       # Architecture, API, deployment docs
└── scripts/                    # Setup and utility scripts
```

---

## Quick Start

### Prerequisites
- Node.js 20+, Docker, Docker Compose

### 1. Clone and install
```bash
git clone https://github.com/dakshgoti14/Backend-Task-Orchestration-System.git
cd Backend-Task-Orchestration-System
npm install
cp .env.example .env
```

### 2. Start infrastructure
```bash
docker-compose -f docker/docker-compose.yml up -d postgres redis
```

### 3. Run migrations
```bash
npm run migrate
```

### 4. Start the API server
```bash
npm run dev
```

### 5. Start a worker node
```bash
npm run worker
```

### 6. Submit your first job
```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-first-job",
    "type": "HTTP_REQUEST",
    "payload": { "url": "https://api.example.com/process", "method": "POST" },
    "priority": "HIGH",
    "scheduledAt": "2024-01-15T10:00:00Z"
  }'
```

---

## API Reference

See [docs/api.md](docs/api.md) for the full REST and GraphQL API reference.

### Key Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/jobs` | Submit a new job |
| `GET` | `/api/v1/jobs` | List jobs with filtering/pagination |
| `GET` | `/api/v1/jobs/:id` | Get job details + execution history |
| `PATCH` | `/api/v1/jobs/:id/cancel` | Cancel a pending/running job |
| `POST` | `/api/v1/jobs/:id/retry` | Manually retry a failed job |
| `GET` | `/api/v1/workers` | List registered worker nodes |
| `GET` | `/api/v1/schedules` | List cron schedules |
| `POST` | `/api/v1/schedules` | Create a recurring schedule |
| `GET` | `/metrics` | Prometheus metrics endpoint |
| `GET` | `/health` | Liveness + readiness probe |

---

## Deployment

See [docs/deployment.md](docs/deployment.md) for full Docker and Kubernetes deployment instructions.

---

## Testing

```bash
npm test              # All tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests (requires DB + Redis)
npm run test:stress   # Stress/load tests
npm run test:coverage # With coverage report
```

---

## Monitoring

- **Prometheus**: `http://localhost:9090/metrics`
- **Grafana**: `http://localhost:3001` (admin/admin)
- **Health check**: `http://localhost:3000/health`
