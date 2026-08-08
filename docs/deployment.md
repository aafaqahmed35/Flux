# Production Deployment & Infrastructure Guide

This document details the production containerization, topology, health checking, multi-process orchestration, scaling strategies, and CI/CD pipelines for **Flux**.

---

## Process Topology

Flux runs as three independently deployable, single-responsibility Node.js processes:

```text
┌─────────────────────────────────────────────────────────┐
│                      Flux API                           │
│  Command: npm run start:api                             │
│  Role: Express HTTP API, REST endpoints, /metrics       │
└──────────────────────────┬──────────────────────────────┘
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
       PostgreSQL        Redis      Flux Worker
                                  Command: npm run start:worker
                                  Role: WorkerRuntime & Processors

       Flux Scheduler
       Command: npm run start:scheduler
       Role: CronEngine & Leader Lock
```

- **`flux-api`**: Serves REST endpoints (`/api/v1/jobs`, `/api/v1/auth`, etc.), `/metrics`, and `/health`. Does NOT start worker execution or scheduler loops.
- **`flux-worker`**: Polls Redis queues, executes job processors, handles retries/DLQ, updates PostgreSQL job states. Does NOT serve HTTP.
- **`flux-scheduler`**: Performs Redis leader lock election (`SCHEDULER_LEADER_TTL_MS`), calculates cron `nextRunAt`, enqueues due recurring jobs. Does NOT execute jobs or serve HTTP.

---

## Health & Liveness Probes

- **`/health/live`**: Fast process liveness check for Kubernetes/Docker. Returns `200 OK` as long as the Node process is responsive (does not query DB/Redis).
- **`/health/ready`**: Deep readiness probe verifying active PostgreSQL (`SELECT 1`) and Redis (`PING`) connectivity. Returns `200 OK` if UP, `503 Service Unavailable` if DOWN.
- **`/health`**: Comprehensive health metric diagnostic endpoint returning database latency, Redis memory/clients, migration count, worker count, scheduler leader status, observability status, and security posture.

---

## Production Docker Compose

Run production stack using `docker-compose.prod.yml`:

```bash
# 1. Export production environment variables
export POSTGRES_DB=flux_prod
export POSTGRES_USER=flux_admin
export POSTGRES_PASSWORD=super-secret-db-pass
export JWT_SECRET=super-secret-jwt-key

# 2. Build and start production container topology
docker compose -f docker-compose.prod.yml up -d
```

---

## Scaling Workers & API Instances

- **Scaling Workers**: Workers poll Redis using atomic BLPOP / ZREMRANGEBYSCORE operations. Scale worker replicas safely:
  ```bash
  docker compose -f docker-compose.prod.yml up -d --scale flux-worker=4
  ```
- **Scaling Scheduler**: Schedulers acquire an atomic Redis leader lock (`flux:scheduler:leader_lock`). Only 1 active leader executes schedule ticks at a time; candidate instances stay standby in failover mode.

---

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) executes on every push/PR to `main`:
1. Launches PostgreSQL 16 and Redis 7 service containers.
2. Runs database migrations (`npm run migrate`).
3. Compiles TypeScript (`npm run build`).
4. Audits ESLint (`npm run lint`) and Prettier (`npm run format:check`).
5. Executes full Jest test suite (`npm test -- --runInBand`).
6. Builds multi-stage production Docker image (`docker build -t flux:latest .`).
