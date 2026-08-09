# Flux Distributed Recovery, Reconciliation & Fault Tolerance Architecture

## Overview

Flux provides high-availability distributed recovery, queue reconciliation, and fault tolerance designed to operate reliably in the presence of process crashes, network partitions, Redis restarts, and database latency.

The system is built on **at-least-once execution semantics**:

* **Canonical Source of Truth:** PostgreSQL persistence layer.
* **Execution & Cache Layer:** Redis data structures (lists, sets, sorted sets).

---

## Key Guarantees & Architecture

### 1. PostgreSQL Authority & Single Conditional Updates
All job status transitions originate in PostgreSQL. Application code never reads a row and updates it in separate un-guarded statements. All recovery transitions execute single atomic conditional SQL statements:

```sql
UPDATE jobs
SET status = $1, version = version + 1, updated_at = NOW()
WHERE id = $2 AND status = $3 AND is_deleted = FALSE;
```

This ensures that concurrent recovery workers or nodes naturally race on database row locks, preventing duplicate recovery execution.

### 2. Active Worker Lease Heartbeat
Workers executing `RUNNING` tasks maintain an active background heartbeat loop renewing `locked_at` every 10 seconds:

```sql
UPDATE jobs
SET locked_at = NOW(), updated_at = NOW()
WHERE id = $1 AND worker_id = $2 AND status = 'RUNNING' AND is_deleted = FALSE;
```

* **Lease Loss Protection:** If a worker loses network connectivity or its lease expires, `updateJobLease` returns `false`. The worker halts task finalization and avoids overwriting the job state.
* **Long-Running Job Safety:** Active workers continuously extend `locked_at`, preventing long-running tasks (>30s) from falsely being flagged as stale.

### 3. Recovery Paths (`RecoveryEngine`)

The `RecoveryEngine` scans PostgreSQL for four fault conditions:

1. **STALE RUNNING:** Jobs in `RUNNING` state whose `locked_at` is older than `leaseTimeoutMs` (default 30s). Evaluates retry policy via `RetryEngine`. Transitions to `RETRYING` (if retries remain) or `FAILED`/`DEAD_LETTER` (if retries exhausted).
2. **STALE CLAIMED:** Jobs in `CLAIMED` state with expired lock timestamps. Transitions `CLAIMED -> QUEUED` and re-enqueues into Redis.
3. **STALE PENDING:** Jobs in `PENDING` state created longer than threshold without reaching Redis (due to producer crash). Transitions `PENDING -> QUEUED` and enqueues into Redis.
4. **MATURED RETRYING:** Jobs in `RETRYING` state whose `next_retry_at <= NOW()`. Transitions `RETRYING -> QUEUED` and enqueues into Redis.

---

## Redis Queue Reconciliation (`QueueReconciler`)

The `QueueReconciler` automatically corrects discrepancies between PostgreSQL and Redis:

* **Missing Queue Entries:** Re-enqueues PostgreSQL `QUEUED` jobs missing from Redis.
* **Stale Processing Items:** Clears Redis processing list items (`flux:processing:<queue>`) for jobs already completed or failed in PostgreSQL.
* **Orphan Cleanup:** Removes Redis job IDs that have no corresponding PostgreSQL record.
* **DLQ Synchronization:** Reconciles the Redis deadletter cache list (`flux:deadletter`) against canonical PostgreSQL `DEAD_LETTER` state.

---

## Distributed Leadership (`RecoveryRuntime`)

* **Leader Key:** `flux:recovery:leader`
* **TTL:** 15,000ms
* **Tick Interval:** 10,000ms

Leader election uses atomic Redis `SET NX PX` lock acquisition and Lua scripts for heartbeat extensions and ownership-verified lock release. In multi-node deployments:
* Exactly one active leader executes recovery and reconciliation ticks.
* Standby nodes monitor leader health and perform automatic failover if the leader node terminates or experiences a network partition.
* PostgreSQL atomic UPDATE conditionals ensure safety even if leadership coordination temporarily fails.

---

## Observability & Prometheus Metrics

| Metric Name | Type | Description |
| :--- | :--- | :--- |
| `flux_recovery_scans_total` | Counter | Total recovery scan iterations executed |
| `flux_jobs_recovered_total` | Counter | Total jobs successfully recovered |
| `flux_jobs_recovery_failed_total` | Counter | Total failed recovery attempts |
| `flux_jobs_stale_total` | Gauge | Count of stale jobs detected in scan |
| `flux_jobs_reconciled_total` | Counter | Total jobs reconciled between PG & Redis |
| `flux_redis_orphans_removed_total` | Counter | Total orphan Redis references removed |
| `flux_recovery_duration_ms` | Histogram | Duration of recovery scan execution |
| `flux_recovery_conflicts_total` | Counter | Total recovery race condition conflicts |

---

## HTTP Security & API Endpoints

All recovery endpoints require API Key or JWT authentication:

* **`GET /api/v1/recovery/status`** (Scope: `recovery:read`) — Returns active leader state, runtime status, and recovery metrics.
* **`GET /api/v1/recovery/stale`** (Scope: `recovery:read`) — Returns current stale RUNNING, CLAIMED, and PENDING jobs.
* **`POST /api/v1/recovery/run`** (Scope: `recovery:write` or `ADMIN`) — Manually triggers an immediate recovery and reconciliation scan.
