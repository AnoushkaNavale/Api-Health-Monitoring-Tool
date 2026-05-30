import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '@monitor/db';
import type { ApiMetrics, HourlyMetricBucket } from '@monitor/types';

// ─── Validation ─────────────────────────────────────────────────────────────

const MetricsQuerySchema = z.object({
  hours: z
    .string()
    .optional()
    .transform((v) => parseInt(v ?? '24'))
    .pipe(z.number().int().min(1).max(720)), // max 30 days
});

const HourlyQuerySchema = z.object({
  days: z
    .string()
    .optional()
    .transform((v) => parseInt(v ?? '7'))
    .pipe(z.number().int().min(1).max(30)),
});

// ─── Helper: assert API ownership without fetching full row ──────────────────

async function ownsApi(apiId: string, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT 1 FROM monitored_apis WHERE id = $1 AND user_id = $2',
    [apiId, userId]
  );
  return rows.length > 0;
}

// ─── Route plugin ───────────────────────────────────────────────────────────

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /apis/:id/metrics
  // Aggregate stats for the last N hours (raw table — accurate, slightly slower)
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string };
  }>(
    '/:id/metrics',
    async (request, reply) => {
      if (!(await ownsApi(request.params.id, request.user.id))) {
        return reply.code(404).send({ error: 'API not found' });
      }

      const parsed = MetricsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
      }
      const hours = parsed.data;

      const { rows } = await db.query<ApiMetrics>(
        `SELECT
           COUNT(*)::int                                                    AS total_checks,
           COUNT(*) FILTER (WHERE is_success)::int                         AS successful_checks,
           COALESCE(
             ROUND(100.0 * COUNT(*) FILTER (WHERE is_success) / NULLIF(COUNT(*), 0), 2),
             0
           )::float                                                         AS uptime_pct,
           COALESCE(ROUND(AVG(response_ms)::numeric, 2), 0)::float         AS avg_latency_ms,
           COALESCE(
             PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_ms),
             0
           )::float                                                         AS p95_latency_ms,
           COALESCE(
             ROUND(100.0 * COUNT(*) FILTER (WHERE NOT is_success) / NULLIF(COUNT(*), 0), 2),
             0
           )::float                                                         AS error_rate_pct
         FROM health_checks
         WHERE api_id = $1
           AND checked_at > NOW() - ($2 || ' hours')::INTERVAL`,
        [request.params.id, hours]
      );

      return reply.send({ ...rows[0], window_hours: hours });
    }
  );

  // GET /apis/:id/metrics/hourly
  // Served from the TimescaleDB continuous aggregate — very fast even at scale
  fastify.get<{
    Params: { id: string };
    Querystring: { days?: string };
  }>(
    '/:id/metrics/hourly',
    async (request, reply) => {
      if (!(await ownsApi(request.params.id, request.user.id))) {
        return reply.code(404).send({ error: 'API not found' });
      }

      const parsed = HourlyQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
      }
      const days = parsed.data;

      const { rows } = await db.query<HourlyMetricBucket>(
        `SELECT
           bucket,
           COALESCE(avg_latency_ms, 0)::float                             AS avg_latency_ms,
           COALESCE(p95_latency_ms, 0)::float                             AS p95_latency_ms,
           COALESCE(max_latency_ms, 0)::float                             AS max_latency_ms,
           COALESCE(
             ROUND(100.0 * successful_checks / NULLIF(total_checks, 0), 2),
             100
           )::float                                                        AS uptime_pct,
           COALESCE(total_checks, 0)::int                                  AS total_checks,
           COALESCE(failed_checks, 0)::int                                 AS failed_checks
         FROM hourly_metrics
         WHERE api_id = $1
           AND bucket > NOW() - ($2 || ' days')::INTERVAL
         ORDER BY bucket ASC`,
        [request.params.id, days]
      );

      return reply.send({ data: rows, window_days: days });
    }
  );

  // GET /apis/:id/metrics/latency-percentiles
  // Detailed percentile breakdown for a time window (P50, P75, P90, P95, P99)
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string };
  }>(
    '/:id/metrics/latency-percentiles',
    async (request, reply) => {
      if (!(await ownsApi(request.params.id, request.user.id))) {
        return reply.code(404).send({ error: 'API not found' });
      }

      const parsed = MetricsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
      }
      const hours = parsed.data;

      const { rows } = await db.query(
        `SELECT
           PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_ms)::float AS p50,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY response_ms)::float AS p75,
           PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY response_ms)::float AS p90,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_ms)::float AS p95,
           PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_ms)::float AS p99,
           MIN(response_ms)::float                                           AS min_ms,
           MAX(response_ms)::float                                           AS max_ms
         FROM health_checks
         WHERE api_id = $1
           AND checked_at > NOW() - ($2 || ' hours')::INTERVAL
           AND response_ms IS NOT NULL`,
        [request.params.id, hours]
      );

      return reply.send({ ...rows[0], window_hours: hours });
    }
  );

  // GET /apis/:id/metrics/checks
  // Raw paginated check log — used by the failure timeline on the dashboard
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string; before?: string; success_only?: string };
  }>(
    '/:id/metrics/checks',
    async (request, reply) => {
      if (!(await ownsApi(request.params.id, request.user.id))) {
        return reply.code(404).send({ error: 'API not found' });
      }

      const limit = Math.min(parseInt(request.query.limit ?? '50'), 200);
      const before = request.query.before ?? new Date().toISOString();
      const successOnly = request.query.success_only === 'true';

      const { rows } = await db.query(
        `SELECT id, checked_at, status_code, response_ms,
                is_success, error_message, region
         FROM health_checks
         WHERE api_id = $1
           AND checked_at < $2::TIMESTAMPTZ
           ${successOnly ? 'AND is_success = FALSE' : ''}
         ORDER BY checked_at DESC
         LIMIT $3`,
        [request.params.id, before, limit]
      );

      return reply.send({ data: rows, count: rows.length });
    }
  );

  // GET /metrics/summary  — dashboard overview across all user's APIs
  fastify.get(
    '/summary',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { rows } = await db.query(
        `SELECT
           COUNT(*)::int                                           AS total_apis,
           COUNT(*) FILTER (WHERE state = 'UP')::int              AS apis_up,
           COUNT(*) FILTER (WHERE state = 'DEGRADED')::int        AS apis_degraded,
           COUNT(*) FILTER (WHERE state = 'DOWN')::int            AS apis_down,
           COUNT(*) FILTER (WHERE NOT is_active)::int             AS apis_paused
         FROM monitored_apis
         WHERE user_id = $1`,
        [request.user.id]
      );

      // 24h aggregate across ALL user APIs
      const { rows: agg } = await db.query(
        `SELECT
           COALESCE(ROUND(AVG(avg_latency_ms)::numeric, 2), 0)::float  AS avg_latency_ms,
           COALESCE(
             ROUND(
               100.0 * SUM(successful_checks) / NULLIF(SUM(total_checks), 0),
               2
             ),
             100
           )::float                                                      AS overall_uptime_pct
         FROM hourly_metrics hm
         JOIN monitored_apis ma ON ma.id = hm.api_id
         WHERE ma.user_id = $1
           AND hm.bucket > NOW() - INTERVAL '24 hours'`,
        [request.user.id]
      );

      return reply.send({ ...rows[0], ...agg[0] });
    }
  );
}
