# API Reference

Base URL: `http://localhost:3000/api/v1`

All endpoints require an `Authorization` header:
- `Authorization: Bearer <jwt_token>` — for JWT tokens
- `Authorization: ApiKey <api_key>` — for API keys

---

## Jobs

### Submit a Job

`POST /jobs`

**Required scope:** `jobs:write`

**Request body:**
```json
{
  "name": "fetch-daily-report",
  "type": "HTTP_REQUEST",
  "payload": {
    "url": "https://api.example.com/reports/daily",
    "method": "POST",
    "body": { "date": "2024-01-15" }
  },
  "priority": "HIGH",
  "scheduledAt": "2024-01-15T09:00:00Z",
  "timeoutMs": 60000,
  "retryConfig": {
    "maxRetries": 3,
    "retryDelay": 5000,
    "retryBackoff": "EXPONENTIAL"
  },
  "tags": ["reports", "daily"],
  "metadata": { "department": "analytics" }
}
```

**Response `201`:**
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "fetch-daily-report",
    "status": "PENDING",
    "priority": "HIGH",
    "scheduledAt": "2024-01-15T09:00:00Z",
    "createdAt": "2024-01-15T08:00:00Z"
  }
}
```

---

### List Jobs

`GET /jobs?status=FAILED&priority=HIGH&page=1&limit=20`

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `status` | string | Filter by status |
| `priority` | string | Filter by priority |
| `type` | string | Filter by job type |
| `search` | string | Full-text search on name |
| `tags` | string[] | Filter by tags (AND) |
| `page` | int | Page number (default: 1) |
| `limit` | int | Items per page (max: 100) |
| `sortBy` | string | `createdAt`, `scheduledAt`, `priority`, `status` |
| `sortOrder` | string | `ASC` or `DESC` |

**Response `200`:**
```json
{
  "data": [...],
  "meta": {
    "total": 1523,
    "page": 1,
    "limit": 20,
    "totalPages": 77
  }
}
```

---

### Get Job Details

`GET /jobs/:id`

**Response `200`:**
```json
{
  "data": {
    "id": "550e8400-...",
    "name": "fetch-daily-report",
    "status": "COMPLETED",
    "priority": "HIGH",
    "retryCount": 0,
    "startedAt": "2024-01-15T09:00:01Z",
    "completedAt": "2024-01-15T09:00:03Z",
    "result": { "statusCode": 200, "data": { "rows": 1523 } }
  }
}
```

**Error `404`:** Job not found
**Error `403`:** Job belongs to different organization

---

### Get Job Execution History

`GET /jobs/:id/history`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "...",
      "attemptNumber": 1,
      "status": "FAILED",
      "startedAt": "...",
      "durationMs": 5123,
      "errorMessage": "Connection refused",
      "errorCode": "HTTP_ERROR"
    },
    {
      "id": "...",
      "attemptNumber": 2,
      "status": "COMPLETED",
      "startedAt": "...",
      "durationMs": 823
    }
  ]
}
```

---

### Cancel a Job

`PATCH /jobs/:id/cancel`

**Response `200`:** Updated job with `status: "CANCELLED"`

**Error `409`:** Cannot cancel job in terminal status (COMPLETED/FAILED/CANCELLED)

---

### Retry a Failed Job

`POST /jobs/:id/retry`

**Response `200`:** Updated job with `status: "PENDING"`

**Error `409`:** Job is not in a retryable status

---

### Bulk Cancel Jobs

`POST /jobs/bulk/cancel`

```json
{ "ids": ["uuid1", "uuid2", "uuid3"] }
```

**Response `200`:**
```json
{
  "data": {
    "cancelled": ["uuid1", "uuid3"],
    "skipped": ["uuid2"]
  }
}
```

---

### Job Statistics

`GET /jobs/stats`

**Response `200`:**
```json
{
  "data": {
    "total": 15234,
    "byStatus": {
      "PENDING": 42,
      "QUEUED": 8,
      "RUNNING": 15,
      "COMPLETED": 14800,
      "FAILED": 312,
      "CANCELLED": 57
    },
    "avgDurationMs": 4523
  }
}
```

---

## Schedules

### Create a Schedule

`POST /schedules`

```json
{
  "name": "Daily Report Generator",
  "cronExpression": "0 9 * * 1-5",
  "timezone": "America/New_York",
  "jobTemplate": {
    "type": "HTTP_REQUEST",
    "payload": { "url": "https://api.example.com/generate-report" },
    "priority": "MEDIUM",
    "timeoutMs": 120000,
    "tags": ["scheduled", "reports"]
  }
}
```

**Cron expression examples:**

| Expression | Description |
|---|---|
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Every hour |
| `0 9 * * 1-5` | Weekdays at 9 AM |
| `0 0 1 * *` | First day of each month |

---

## Workers

### List Workers

`GET /workers`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "...",
      "hostname": "worker-pod-1",
      "status": "BUSY",
      "currentJobCount": 7,
      "maxConcurrency": 10,
      "lastHeartbeatAt": "2024-01-15T09:01:30Z"
    }
  ]
}
```

### Worker Metrics

`GET /workers/metrics`

```json
{
  "data": {
    "total": 5,
    "online": 2,
    "busy": 3,
    "offline": 0,
    "lost": 0,
    "totalCapacity": 50,
    "usedCapacity": 31
  }
}
```

---

## Dead Letter Queue

### List DLQ Entries

`GET /jobs/dlq`

### Replay DLQ Entry

`POST /jobs/dlq/:dlqId/replay`

### Replay All DLQ Entries

`POST /jobs/dlq/replay-all`

---

## Health & Metrics

### Liveness Probe

`GET /health/live` — Always returns `200 { "status": "ok" }`

### Readiness Probe

`GET /health/ready` — Returns `200` if DB + Redis are healthy, `503` otherwise.

### Full Health Report

`GET /health`

### Prometheus Metrics

`GET /metrics` — Returns Prometheus text format metrics.

---

## GraphQL

**Endpoint:** `POST /graphql`

**Example query:**
```graphql
query {
  jobs(status: FAILED, limit: 10) {
    data {
      id
      name
      errorMessage
      retryCount
      executionHistory {
        attemptNumber
        durationMs
        errorMessage
      }
    }
    total
  }
}
```

**Example mutation:**
```graphql
mutation {
  createJob(input: {
    name: "my-job"
    type: HTTP_REQUEST
    payload: { url: "https://example.com" }
    priority: HIGH
  }) {
    id
    status
  }
}
```
