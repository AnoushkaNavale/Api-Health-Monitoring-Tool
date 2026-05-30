# Distributed API Monitoring & Alerting System

A production-grade distributed system for monitoring REST API health at scale.

## Architecture

- **Scheduler** — BullMQ repeatable jobs, per-API configurable intervals, pg_notify reactive sync
- **Worker Pool** — Async parallel HTTP checks, 50 concurrent per pod, exponential backoff retry
- **State Engine** — UP / DEGRADED / DOWN transitions with threshold-based failure detection
- **TimescaleDB** — Hypertable time-series storage, continuous aggregates for fast metrics
- **Alerting** — Email + Slack/Discord webhooks with Redis-backed cooldown
- **REST API** — Fastify + JWT auth + rate limiting + public status pages

## Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Runtime    | Node.js 20 + TypeScript           |
| Queue      | BullMQ + Redis 7                  |
| Database   | PostgreSQL 16 + TimescaleDB       |
| API        | Fastify 4                         |
| Auth       | JWT (HS256) + bcrypt              |
| Infra      | Docker Compose → Kubernetes       |
| CI/CD      | GitHub Actions                    |

## Quick Start

```bash
# 1. Copy env file
cp .env.example .env

# 2. Start all services
docker compose up -d

# 3. API is live at http://localhost:3000
# 4. Register a user
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"password123"}'

# 5. Add an API to monitor
curl -X POST http://localhost:3000/apis \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My API","url":"https://api.example.com/health","interval_sec":60}'
```

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/register | Create account |
| POST | /auth/login | Get JWT token |
| GET | /auth/me | Current user |
| GET | /apis | List monitored APIs |
| POST | /apis | Add API to monitor |
| PATCH | /apis/:id | Update API config |
| DELETE | /apis/:id | Remove API |
| GET | /apis/:id/status | Current state + recent checks |
| GET | /apis/:id/metrics | Uptime %, avg/p95 latency, error rate |
| GET | /apis/:id/metrics/hourly | Hourly buckets for charting |
| GET | /apis/:id/metrics/latency-percentiles | P50/P75/P90/P95/P99 |
| GET | /apis/:id/metrics/checks | Paginated check log |
| GET | /metrics/summary | Dashboard overview |
| PUT | /alerts/configs/:apiId | Upsert alert config |
| GET | /alerts/history | Alert history (paginated) |
| POST | /alerts/status-pages | Create public status page |
| GET | /status/:slug | Public status page (no auth) |

## Project Structure

```
distributed-api-monitor/
├── apps/
│   ├── api/          # Fastify REST API
│   └── scheduler/    # BullMQ job scheduler
├── packages/
│   ├── db/           # PostgreSQL client + migrations
│   ├── queue/        # BullMQ config + queue factory
│   └── types/        # Shared TypeScript interfaces
├── docker-compose.yml
└── turbo.json
```

## Scaling Workers

```bash
# Run 5 worker instances locally
docker compose up --scale worker=5
```

For Kubernetes, the worker deployment has HPA configured to scale based on queue depth.
