# Flux Operational Dashboard & Flow View ⚡

## Overview

The **Flux Operational Dashboard** is a zero-dependency, dark-mode control plane served directly by the Express API at `/dashboard`. It provides full visual inspection and management capabilities over Flux's job processing pipeline, active queues, worker nodes, cron schedules, distributed recovery, and system metrics.

---

## Architectural Identity & Visual Design

- **Dark Infrastructure Aesthetic:** Base background `#090d16`, surface cards `#1e293b`, system font stack (`Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`).
- **Color Palette:**
  - **Purple (`#8b5cf6`):** Producers & Job Creation
  - **Blue (`#3b82f6`):** Redis Queue Transport
  - **Cyan (`#06b6d4`):** Worker Runtime Nodes
  - **Green (`#10b981`):** Canonical PostgreSQL Database State & Healthy Operations
  - **Amber/Orange (`#f59e0b`):** Exponential Backoff Retries & Warnings
  - **Crimson Red (`#ef4444`):** Dead Letter Queue (DLQ) & Failures

---

## 8 Operational Views

### 1. Overview
- Real-time system liveness status badge, uptime indicator, queue depth totals, active worker counts, throughput meters, and fault tolerance stats.

### 2. Flow View ⭐ (Hero Screen)
- Interactive visual stream showing end-to-end data pipeline flow:
  `Producers (API/Triggers)` ➔ `Queues (Redis Transport)` ➔ `Workers (Execution Nodes)` ➔ `Storage (PostgreSQL 16)`
  With connected auxiliary nodes for `Cron Scheduler`, `Retries (Exponential Backoff)`, `Dead Letter Queue (DLQ)`, `Recovery Engine (Leader Lock)`, and `Observability (OTel/Prometheus)`.
- Animated stream indicators illustrate active throughput.

### 3. Jobs Management
- Filterable job grid supporting status filters (`ALL`, `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `RETRYING`, `DLQ`), priority badges, attempt tracking, and quick job creation triggers.

### 4. Queue Transport
- Real-time queue depth meters breakdown across configured transport queues (`default`, `high-priority`).

### 5. Worker Runtimes
- Active worker nodes, concurrency capacity gauges, processing rates, and active execution lists.

### 6. Cron Schedules
- Scheduled cron tasks (`cronExpression`, `nextRunAt`, `enabled`, `totalRuns`) and schedule creation triggers.

### 7. Distributed Recovery
- Recovery engine leadership role status (`LEADER` / `STANDBY`), scan count, stale job recovery counts, transport reconciliation stats, and manual recovery scan trigger.

### 8. Metrics
- Real-time Prometheus gauge metrics displaying PostgreSQL active, idle, and waiting connection pool counts.

---

## Dashboard Authentication

The dashboard integrates directly with Flux's JWT & API Key authentication layer:
- Accessing `/dashboard` prompts a sleek modal for authentication if no valid token exists in `sessionStorage`.
- Supports JWT login (`POST /api/v1/auth/login`) or direct API Secret Key (`x-api-key`).
- Session tokens are stored in `sessionStorage` and attached to all background polling requests.
