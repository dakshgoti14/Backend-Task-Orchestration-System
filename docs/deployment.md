# Deployment Guide

## Local Development

### Prerequisites
- Node.js 20+
- Docker + Docker Compose
- Git

### Setup

```bash
# 1. Clone repository
git clone https://github.com/dakshgoti14/Backend-Task-Orchestration-System.git
cd Backend-Task-Orchestration-System

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your local settings

# 4. Start infrastructure
docker-compose -f docker/docker-compose.yml up -d postgres redis

# 5. Run database migrations
npm run migrate

# 6. Start API server
npm run dev

# 7. Start a worker (in a new terminal)
npm run worker
```

### Verify

```bash
# API health
curl http://localhost:3000/health

# Submit a test job
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","type":"HTTP_REQUEST","payload":{"url":"https://httpbin.org/get"},"organizationId":"org1","createdBy":"user1"}'
```

---

## Docker Compose (Full Stack)

```bash
# Start all services (API + workers + monitoring)
docker-compose -f docker/docker-compose.yml up -d

# Scale workers
docker-compose -f docker/docker-compose.yml up -d --scale worker=5

# View logs
docker-compose -f docker/docker-compose.yml logs -f api worker

# Stop everything
docker-compose -f docker/docker-compose.yml down -v
```

**Service URLs:**
- API: http://localhost:3000
- GraphQL: http://localhost:3000/graphql
- Prometheus: http://localhost:9091
- Grafana: http://localhost:3001 (admin/admin)

---

## Kubernetes Deployment

### Prerequisites
- kubectl configured for your cluster
- Container registry access (GitHub Container Registry)

### Steps

```bash
# 1. Update secrets in k8s/configmap.yaml (use actual values)
kubectl create secret generic btos-secrets \
  --from-literal=DB_PASSWORD=your_password \
  --from-literal=JWT_SECRET=your_jwt_secret \
  -n btos

# 2. Apply manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml

# 3. Verify rollout
kubectl rollout status deployment/btos-api -n btos
kubectl rollout status deployment/btos-worker -n btos

# 4. Check pods
kubectl get pods -n btos

# 5. View logs
kubectl logs -l app=btos-api -n btos --follow
```

### Rolling Update

```bash
# Update to new image tag
kubectl set image deployment/btos-api \
  btos-api=ghcr.io/dakshgoti14/backend-task-orchestration-system:v1.2.3 \
  -n btos

# Monitor rollout
kubectl rollout status deployment/btos-api -n btos

# Rollback if needed
kubectl rollout undo deployment/btos-api -n btos
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Runtime environment |
| `PORT` | No | `3000` | HTTP server port |
| `DB_HOST` | Yes | — | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_NAME` | No | `task_orchestration` | Database name |
| `DB_USER` | No | `postgres` | Database user |
| `DB_PASSWORD` | Yes | — | Database password |
| `REDIS_HOST` | No | `localhost` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `JWT_SECRET` | Yes | — | JWT signing secret (min 32 chars) |
| `WORKER_CONCURRENCY` | No | `10` | Max parallel jobs per worker |
| `WORKER_MAX_RETRIES` | No | `3` | Default max retry attempts |
| `SCHEDULER_POLL_INTERVAL_MS` | No | `1000` | Scheduler poll frequency |
| `ALERT_WEBHOOK_URL` | No | — | Slack/webhook URL for alerts |

---

## Production Checklist

- [ ] Change `JWT_SECRET` to a cryptographically random 256-bit string
- [ ] Change `DB_PASSWORD` to a strong password
- [ ] Enable SSL for PostgreSQL (`DB_SSL=true`)
- [ ] Set `NODE_ENV=production`
- [ ] Configure `ALERT_WEBHOOK_URL` for incident alerts
- [ ] Set up Prometheus scraping + Grafana dashboards
- [ ] Configure Kubernetes resource limits
- [ ] Enable HPA autoscaling
- [ ] Set up log aggregation (e.g., ELK stack, Datadog)
- [ ] Configure backup for PostgreSQL
- [ ] Set up Redis persistence (`appendonly yes`)
- [ ] Review and restrict CORS `origin` setting
