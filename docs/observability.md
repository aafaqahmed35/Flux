# Flux Observability, Metrics & OpenTelemetry Architecture

Flux provides production-grade observability covering Prometheus metrics, OpenTelemetry tracing, job/queue/worker/scheduler instrumentation, correlation propagation, and health diagnostics.

---

## 1. Metrics Architecture

Flux exposes Prometheus-compatible metrics at:

```http
GET /metrics
```

### Key Metric Catalog

| Metric Name | Type | Description | Labels |
| :--- | :--- | :--- | :--- |
| `flux_jobs_created_total` | Counter | Total jobs submitted | `queue`, `priority` |
| `flux_jobs_completed_total` | Counter | Total jobs completed successfully | `queue` |
| `flux_jobs_failed_total` | Counter | Total jobs failed | `queue`, `failure_type` |
| `flux_jobs_retried_total` | Counter | Total jobs scheduled for retry | `queue`, `strategy` |
| `flux_jobs_dead_lettered_total` | Counter | Total jobs moved to DLQ | `queue` |
| `flux_job_execution_duration_ms` | Histogram | Job execution latency (p50/p95/p99) | `queue`, `status` |
| `flux_job_queue_wait_duration_ms` | Histogram | Job queue wait time before execution | `queue` |
| `flux_queue_depth` | Gauge | Current queue length | `queue` |
| `flux_worker_active` | Gauge | Active workers count | `workerId`, `queue` |
| `flux_worker_busy` | Gauge | Busy workers count | `workerId`, `queue` |
| `flux_scheduler_lag_ms` | Gauge | Cron scheduler tick lag in ms | N/A |
| `flux_api_requests_total` | Counter | Total HTTP API requests | `method`, `route`, `status_code` |
| `flux_api_request_duration_ms` | Histogram | HTTP API request latency | `method`, `route`, `status_code` |

---

## 2. Route Normalization & Label Cardinality

To protect Prometheus from high-cardinality label explosions:
- Dynamic paths with UUIDs (e.g. `/api/v1/jobs/123e4567-e89b-12d3-a456-426614174000`) are automatically normalized to `/api/v1/jobs/:id`.
- High-cardinality fields such as `jobId`, payload contents, raw trace IDs, and raw error messages are strictly excluded from metric labels.

---

## 3. OpenTelemetry Tracing

Flux uses `@opentelemetry/sdk-node` with auto-instrumentations for Express, HTTP, PostgreSQL, and Redis.

### Tracing Spans

- `flux.job.create`
- `flux.job.execute`
- `flux.job.retry`
- `flux.job.dead_letter`
- `flux.worker.process`
- `flux.scheduler.tick`

### Correlation ID Propagation

HTTP requests include `X-Correlation-ID`, which is propagated down to worker execution contexts and trace span attributes.

---

## 4. Failure Isolation

Observability is strictly failure-isolated:
- If the OpenTelemetry OTLP Collector or Prometheus scraper is unreachable, Flux will log warnings and continue running normally without crashing business execution.
