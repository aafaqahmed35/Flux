# Vercel Deployment & Runtime Architecture

## Overview

Flux supports deployment of its HTTP API layer to **Vercel Serverless Functions**, while keeping long-running background runtimes (**WorkerRuntime**, **SchedulerRuntime**, **RecoveryRuntime**) in external persistent processes (Docker / VM / ECS).

---

## Architectural Separation

```
                    ┌─────────────────┐
                    │     Vercel      │
                    │   Flux API      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   PostgreSQL    │
                    │ Canonical State │
                    └─────────────────┘
                             │
                    ┌────────▼────────┐
                    │      Redis      │
                    │ Transport/Cache │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
     Worker Runtime    Scheduler Runtime   Recovery Runtime
     (Persistent)       (Persistent)       (Persistent)
```

### 1. Vercel Serverless API (`api/index.ts`)
* **Role:** Serves stateful REST endpoints (`/api/v1/jobs`, `/health`, `/metrics`, `/api/v1/schedules`, `/api/v1/recovery`, `/api/v1/deadletter`).
* **Behavior:** Statistically reuses PostgreSQL and Redis connection pools across function invocations without running persistent loops or background intervals.
* **Entrypoint:** [`api/index.ts`](../api/index.ts) exporting Express `app`.

### 2. Persistent Background Runtimes (Docker / ECS / VM)
* **Workers (`npm run start:worker`):** Continuously pull jobs from Redis queues, execute processors, update PostgreSQL status, and send heartbeat renewals.
* **Scheduler (`npm run start:scheduler`):** Evaluates cron expressions and enqueues recurring/delayed tasks into Redis.
* **Recovery (`npm run start:recovery`):** Scans for orphaned or stale claimed jobs using Redis leader locks and conditional atomic SQL state updates.

---

## Environment Variables Required on Vercel

Ensure the following environment variables are set in your Vercel Project Settings:

| Key | Description | Example |
| :--- | :--- | :--- |
| `NODE_ENV` | Runtime environment mode | `production` |
| `JWT_SECRET` | Production secret key for signing JWT tokens | `min-32-char-secure-random-secret` |
| `POSTGRES_HOST` | Remote PostgreSQL host (e.g. Supabase / Neon / AWS RDS) | `db.region.postgres.cloud` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_DB` | PostgreSQL database name | `flux_prod` |
| `POSTGRES_USER` | PostgreSQL user | `flux_user` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `[SECURE]` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host:5432/db` |
| `REDIS_HOST` | Remote Redis host (e.g. Upstash / Redis Cloud) | `redis-12345.upstash.io` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | `[SECURE]` |
| `REDIS_DB` | Redis database index | `0` |

---

## Deployment Steps

1. Install Vercel CLI or connect your GitHub repository to Vercel.
2. Link the project: `vercel link`
3. Deploy to production: `vercel --prod`
