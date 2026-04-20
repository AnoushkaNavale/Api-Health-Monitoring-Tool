# Distributed API Monitoring & Alerting System

A scalable system for continuously monitoring APIs, analyzing performance, and triggering alerts based on defined conditions.

---

## Overview

This project extends a basic API health checker into a distributed system capable of:

* Running periodic health checks
* Measuring latency, uptime, and error rates
* Detecting failures using thresholds
* Triggering alerts via multiple channels
* Visualizing system health through a dashboard

---

## Architecture

```
Scheduler → Queue → Workers → Metrics Engine → State Engine → Alerting → Dashboard
```

### Components

* API Service – REST endpoints for managing APIs, metrics, and alerts
* Scheduler – Creates periodic jobs using a queue
* Worker Service – Executes API checks concurrently
* Alerting Service – Evaluates failures and triggers alerts
* Dashboard – Displays system health and analytics
* Database – Stores APIs, logs, and metrics

---

## Tech Stack

### Backend

* Node.js
* Fastify
* PostgreSQL (or TimescaleDB)
* Redis + BullMQ

### Frontend

* Next.js
* Chart.js or Recharts

### Infrastructure

* Docker
* Docker Compose
* Kubernetes (optional)

---

## Project Structure

```
distributed-api-monitor/
├── apps/
│   ├── api/
│   ├── scheduler/
│   ├── worker/
│   ├── alerting/
│   └── dashboard/
│
├── packages/
│   ├── db/
│   ├── queue/
│   └── types/
│
├── infra/
│   ├── docker-compose.yml
│   └── k8s/
```

---

## How It Works

1. APIs are registered through the API service
2. Scheduler creates periodic jobs
3. Jobs are pushed to a Redis queue
4. Workers process jobs in parallel:

   * Send HTTP request
   * Measure response time
   * Store result
5. Metrics engine computes:

   * Uptime percentage
   * Latency trends
   * Error rates
6. State engine determines:

   * UP
   * DEGRADED
   * DOWN
7. Alerting service triggers notifications
8. Dashboard displays system data

---

## Features

### Core

* Periodic API monitoring
* Parallel execution using worker queues
* Retry with exponential backoff
* Threshold-based failure detection
* State transitions (UP / DEGRADED / DOWN)

### Metrics

* Uptime percentage
* Average and p95 latency
* Error rate tracking
* Historical logs

### Alerting

* Email alerts
* Webhook alerts (Slack, Discord)
* Alert cooldown

### Dashboard

* Real-time API status
* Latency graphs
* Failure timeline

---

## Authentication (Optional)

* JWT-based authentication
* Multi-user API management

---

## Running Locally

### Clone the repository

```
git clone <your-repo-url>
cd distributed-api-monitor
```

### Start services

```
docker-compose up --build
```

### Access

* API: http://localhost:3000
* Dashboard: http://localhost:3001

---

## Scaling

* Worker services can be scaled horizontally
* Queue-based architecture distributes load
* Kubernetes configuration supports auto-scaling

---

## Use Case

Monitor critical APIs such as authentication services, payment systems, and third-party integrations to detect issues before they impact users.

---

## Future Improvements

* Region-based monitoring
* Anomaly detection for latency
* Public status page
* CI/CD integration

---

## What This Project Demonstrates

* Distributed system design
* Asynchronous processing
* Fault tolerance
* Observability and monitoring
* Backend scalability

---

## License

MIT License

---

## Author

Anoushka Navale
