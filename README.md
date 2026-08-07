# Flux ⚡

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.19-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7.0-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Enabled-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

**Flux** is a production-style, enterprise-grade background job processing platform designed to execute asynchronous tasks reliably using queues, workers, retries, and cron scheduling.

---

## 📐 Architecture Overview

```mermaid
graph TD
    Client[Client / Application] -->|HTTP Request| API[Express API Server]
    API -->|Validation & Middleware| Controller[Health & Router]
    API -->|Log Transport| Winston[Categorized Winston Loggers]

    subgraph Infrastructure Foundations
        Postgres[(PostgreSQL 16)]
        Redis[(Redis 7 Cache/Queue)]
        Adminer[Adminer DB GUI]
    end

    API -.->|Connection Pool| Postgres
    API -.->|iORedis Client| Redis
    Adminer -.->|Inspect| Postgres
```

---

## 🎯 Project Philosophy

1. **Strict Type Safety**: Everything is powered by TypeScript in strict mode, preventing runtime type coercion and contract drift.
2. **Centralized & Validated Config**: All runtime variables pass through Zod schemas at startup—no magic numbers, defaults, or missing secret crashes.
3. **Categorized Observability**: Separate Winston logger streams (`appLogger`, `httpLogger`, `errorLogger`, `workerLogger`) ensure actionable logs without clutter.
4. **Decoupled Architecture**: Clean separation between routes, controllers, middleware, domain entities, repositories, and services.
5. **Zero Premature Overhead**: Pure infrastructure foundations and extension points ready for job queue engines without code churn.

---

## 🔌 Port Allocation & Permanent Flux Namespace

Flux intentionally avoids common host ports (`3000`, `5000`, `5432`, `6379`, `8080`, `8081`) to eliminate port collisions with host operating system services, Homebrew daemons, Docker default bindings, and other local backend projects.

| Service        | Host Machine Port | Internal Container Port | Description                         |
| :------------- | :---------------- | :---------------------- | :---------------------------------- |
| **Flux API**   | `18082`           | `3000`                  | HTTP Express Application Server     |
| **PostgreSQL** | `15433`           | `5432`                  | Primary Relational Database         |
| **Redis**      | `16379`           | `6379`                  | Cache & Background Job Queue Broker |
| **Adminer**    | `18086`           | `8080`                  | Web-Based Database Management GUI   |

_Note: Container internal networking remains standard (`3000`, `5432`, `6379`, `8080`), ensuring clean container isolation while isolating host machine bindings._

---

## 🗺️ System Roadmap

- [x] **Phase 1: Foundation & Infrastructure Bootstrap** _(Current)_
- [ ] **Phase 2: Job Domain Models & Persistence Layer**
- [ ] **Phase 3: Redis-Backed Queue Engine & Task Enqueuing**
- [ ] **Phase 4: Multi-Threaded Worker Process Execution**
- [ ] **Phase 5: Automated Retry Mechanisms & Exponential Backoff**
- [ ] **Phase 6: Cron & Deferred Task Scheduling**
- [ ] **Phase 7: Dead Letter Queue (DLQ) & Failure Recovery**
- [ ] **Phase 8: Job Metrics, Analytics & Dashboard API**

---

## 📁 Folder Structure

```
flux/
├── src/
│   ├── config/             # Environment validation (Zod) & modular configs
│   │   ├── database.ts     # PostgreSQL connection pool settings
│   │   ├── env.ts          # Strongly typed environment schema
│   │   ├── index.ts        # Central configuration registry
│   │   ├── logger.ts       # Winston logging configuration
│   │   ├── redis.ts        # Redis client configuration
│   │   └── server.ts       # Express server settings
│   ├── constants/          # Status codes and HTTP response message constants
│   ├── controllers/        # Request controllers (e.g. HealthController)
│   ├── database/           # PostgreSQL connection pool & lifecycle management
│   ├── domain/             # Job, Queue, & Task domain entities (Extension Point)
│   ├── errors/             # Custom operational error classes (AppError, etc.)
│   ├── events/             # Application event emitters (Extension Point)
│   ├── interfaces/         # Core TypeScript interfaces & API payload schemas
│   ├── logger/             # Winston categorized loggers (app, http, error)
│   ├── middleware/         # Express middlewares (requestLogger, error, notFound)
│   ├── queue/              # Queue managers & producers (Extension Point)
│   ├── redis/              # Redis client singleton & health checkers
│   ├── repositories/       # Data access repositories (Extension Point)
│   ├── routes/             # Express API route declarations
│   ├── scheduler/          # Cron job schedulers (Extension Point)
│   ├── services/           # Business logic orchestrators (Extension Point)
│   ├── types/              # Domain types and error code enums
│   ├── utils/              # Pure utility functions
│   ├── workers/            # Background worker process consumers (Extension Point)
│   ├── app.ts              # Express initialization, security & global middlewares
│   └── server.ts           # Bootstrapper, infrastructure check & graceful shutdown
├── docker/                 # Production & auxiliary container configurations
├── docs/                   # System design & API specifications
├── scripts/                # Utility & database migration scripts
├── tests/                  # Structured test suites
│   ├── fixtures/           # Mock datasets
│   ├── helpers/            # Test helpers & database utilities
│   ├── integration/        # Supertest API integration tests
│   └── unit/               # Unit test suites
├── .dockerignore           # Exclusions for slim Docker build context
├── .env.example            # Environment variables template
├── .eslintrc.cjs           # Strict ESLint configuration
├── .lintstagedrc.json      # Staged git hooks automation
├── .prettierrc             # Prettier formatting rules
├── docker-compose.yml      # Orchestrates App, PostgreSQL, Redis & Adminer
├── Dockerfile              # Multi-stage production container build
├── Dockerfile.dev          # Hot-reloading development container
├── jest.config.cjs         # Jest ESM configuration
├── package.json            # Dependencies & scripts
├── README.md               # Documentation
├── tsconfig.eslint.json    # ESLint TypeScript inclusion schema
└── tsconfig.json           # Strict TypeScript compiler options
```

---

## 🛠️ Environment Variables Catalog

| Variable                   | Type     | Default         | Description                                               |
| :------------------------- | :------- | :-------------- | :-------------------------------------------------------- |
| `NODE_ENV`                 | `string` | `development`   | Runtime environment (`development`, `production`, `test`) |
| `PORT`                     | `number` | `18082`         | Host port for Express HTTP server                         |
| `APP_NAME`                 | `string` | `Flux`          | Name of the service                                       |
| `APP_VERSION`              | `string` | `1.0.0`         | Application release version                               |
| `LOG_LEVEL`                | `string` | `info`          | Winston log severity level                                |
| `TZ`                       | `string` | `UTC`           | Application default timezone                              |
| `POSTGRES_HOST`            | `string` | `localhost`     | PostgreSQL host server                                    |
| `POSTGRES_PORT`            | `number` | `15433`         | PostgreSQL host port                                      |
| `POSTGRES_DB`              | `string` | `flux_db`       | PostgreSQL database name                                  |
| `POSTGRES_USER`            | `string` | `flux_user`     | PostgreSQL database user                                  |
| `POSTGRES_PASSWORD`        | `string` | `flux_password` | PostgreSQL database password                              |
| `POSTGRES_MAX_CONNECTIONS` | `number` | `20`            | PostgreSQL max pool connections                           |
| `DATABASE_URL`             | `string` | _Computed_      | Full PostgreSQL connection string (`localhost:15433`)     |
| `REDIS_HOST`               | `string` | `localhost`     | Redis server host                                         |
| `REDIS_PORT`               | `number` | `16379`         | Redis server host port                                    |
| `REDIS_PASSWORD`           | `string` | `""`            | Redis authentication password                             |
| `REDIS_DB`                 | `number` | `0`             | Redis logical database index                              |
| `ADMINER_PORT`             | `number` | `18086`         | Web-based database management GUI host port               |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `>= 20.0.0`
- **npm**: `>= 10.0.0`
- **Docker**: `>= 24.0.0` & **Docker Compose**: `>= 2.0.0`

### Local Development Setup

1. **Clone repository & install dependencies**:

   ```bash
   git clone https://github.com/aafaqahmed35/Flux.git
   cd Flux
   npm install
   ```

2. **Configure environment variables**:

   ```bash
   cp .env.example .env
   ```

3. **Start infrastructure via Docker Compose**:

   ```bash
   docker compose up -d postgres redis adminer
   ```

4. **Run development server with hot-reload**:

   ```bash
   npm run dev
   ```

5. **Verify API health**:

   ```bash
   curl http://localhost:18082/health
   ```

   **Response**:

   ```json
   {
     "status": "UP",
     "service": "Flux",
     "version": "1.0.0",
     "uptime": 2.45,
     "timestamp": "2026-08-05T13:36:26.000Z"
   }
   ```

6. **Inspect PostgreSQL Database (Adminer GUI)**:
   Open [http://localhost:18086](http://localhost:18086) in your browser:
   - System: `PostgreSQL`
   - Server: `localhost` (or `postgres` if inside container network)
   - Username: `flux_user`
   - Password: `flux_password`
   - Database: `flux_db`

---

## 🐳 Full Containerized Setup (Docker Compose)

To launch the entire platform inside isolated containers:

```bash
# Build and launch all services in detached mode
docker compose up --build -d

# View logs from all services
docker compose logs -f

# Shut down containers and remove volumes
docker compose down -v
```

---

## 📜 Development Scripts

| Script                  | Command                    | Description                                  |
| :---------------------- | :------------------------- | :------------------------------------------- |
| `npm run dev`           | `tsx watch src/server.ts`  | Starts development server with hot reloading |
| `npm run build`         | `tsc`                      | Compiles TypeScript into `./dist`            |
| `npm run start`         | `node dist/server.js`      | Runs compiled production server              |
| `npm run lint`          | `eslint "src/**/*.ts" ...` | Runs ESLint syntax and rule checks           |
| `npm run lint:fix`      | `eslint ... --fix`         | Automatically fixes lint violations          |
| `npm run format`        | `prettier --write ...`     | Formats codebase using Prettier              |
| `npm run test`          | `jest`                     | Executes integration & unit test suites      |
| `npm run test:watch`    | `jest --watch`             | Runs test runner in interactive watch mode   |
| `npm run test:coverage` | `jest --coverage`          | Generates detailed test coverage report      |

---

## ❓ Troubleshooting Guide

### 1. Port 18082 already in use (`EADDRINUSE`)

If port 18082 is occupied by another local service:

- **Solution A**: Identify and stop the occupying process (`lsof -i :18082` then `kill -9 <PID>`).
- **Solution B**: Update `PORT` in your `.env` file (e.g. `PORT=18083`).

### 2. PostgreSQL already running locally on port 5432

Flux isolates its PostgreSQL container by mapping host port `15433` to container port `5432`:

- Ensure `.env` specifies `POSTGRES_PORT=15433` and `DATABASE_URL=postgres://flux_user:flux_password@localhost:15433/flux_db`.
- When connecting via psql or GUI database clients on host, use port `15433`.

### 3. Docker daemon not running / Socket Error

If `docker compose up` fails with `failed to connect to docker API`:

- Ensure Docker Desktop (or Docker daemon) is running on your machine.
- Verify Docker status with `docker info`.

### 4. Redis unavailable (`ECONNREFUSED`)

If application startup warns about Redis connection failure on host port `16379`:

- Ensure Redis container is running via Docker Compose (`docker compose up -d redis`).
- Verify Redis health status with `docker compose ps`.

### 5. Environment configuration setup issues

If startup fails with `Invalid environment configuration`:

- Verify all required keys in `.env` match [.env.example](file://./.env.example).

---

## 🤝 Contribution & Quality Assurance

All pull requests and commits are enforced via **Husky** and **lint-staged**. Staged TypeScript files are automatically verified by ESLint and formatted via Prettier prior to commit.

To run full validation locally:

```bash
npm run lint && npm run format:check && npm run test && npm run build
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
