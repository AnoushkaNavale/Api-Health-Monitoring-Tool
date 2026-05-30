import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '@monitor/db';
import type { AlertConfig, AlertHistory, StatusPage } from '@monitor/types';

// ─── Validation schemas ─────────────────────────────────────────────────────

const WebhookSchema = z.object({
  url:  z.string().url(),
  type: z.enum(['slack', 'discord', 'generic']),
});

const AlertConfigSchema = z.object({
  failure_threshold:    z.number().int().min(1).max(10).default(3),
  latency_threshold_ms: z.number().int().min(100).default(2000),
  cooldown_minutes:     z.number().int().min(1).max(1440).default(15),
  notify_email:         z.array(z.string().email()).default([]),
  notify_webhooks:      z.array(WebhookSchema).default([]),
});

const StatusPageSchema = z.object({
  slug:      z.string().min(3).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  title:     z.string().min(1).max(100),
  api_ids:   z.array(z.string().uuid()).min(1),
  is_public: z.boolean().default(true),
});

// ─── Route plugin ───────────────────────────────────────────────────────────

export async function alertsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── Alert Configs ──────────────────────────────────────────────────────────

  // GET /alerts/configs/:apiId
  fastify.get<{ Params: { apiId: string } }>(
    '/configs/:apiId',
    async (request, reply) => {
      // Verify ownership
      const { rows: apiRows } = await db.query(
        'SELECT id FROM monitored_apis WHERE id = $1 AND user_id = $2',
        [request.params.apiId, request.user.id]
      );
      if (!apiRows.length) return reply.code(404).send({ error: 'API not found' });

      const { rows } = await db.query<AlertConfig>(
        'SELECT * FROM alert_configs WHERE api_id = $1',
        [request.params.apiId]
      );

      return reply.send(rows[0] ?? null);
    }
  );

  // PUT /alerts/configs/:apiId  (upsert — simpler than separate POST/PATCH)
  fastify.put<{ Params: { apiId: string } }>(
    '/configs/:apiId',
    async (request, reply) => {
      const { rows: apiRows } = await db.query(
        'SELECT id FROM monitored_apis WHERE id = $1 AND user_id = $2',
        [request.params.apiId, request.user.id]
      );
      if (!apiRows.length) return reply.code(404).send({ error: 'API not found' });

      const parsed = AlertConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
      }
      const d = parsed.data;

      const { rows } = await db.query<AlertConfig>(
        `INSERT INTO alert_configs
           (api_id, failure_threshold, latency_threshold_ms,
            cooldown_minutes, notify_email, notify_webhooks)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (api_id) DO UPDATE SET
           failure_threshold    = EXCLUDED.failure_threshold,
           latency_threshold_ms = EXCLUDED.latency_threshold_ms,
           cooldown_minutes     = EXCLUDED.cooldown_minutes,
           notify_email         = EXCLUDED.notify_email,
           notify_webhooks      = EXCLUDED.notify_webhooks,
           updated_at           = NOW()
         RETURNING *`,
        [
          request.params.apiId,
          d.failure_threshold,
          d.latency_threshold_ms,
          d.cooldown_minutes,
          d.notify_email,
          JSON.stringify(d.notify_webhooks),
        ]
      );

      return reply.send(rows[0]);
    }
  );

  // DELETE /alerts/configs/:apiId
  fastify.delete<{ Params: { apiId: string } }>(
    '/configs/:apiId',
    async (request, reply) => {
      const { rows: apiRows } = await db.query(
        'SELECT id FROM monitored_apis WHERE id = $1 AND user_id = $2',
        [request.params.apiId, request.user.id]
      );
      if (!apiRows.length) return reply.code(404).send({ error: 'API not found' });

      await db.query('DELETE FROM alert_configs WHERE api_id = $1', [request.params.apiId]);
      return reply.code(204).send();
    }
  );

  // ── Alert History ──────────────────────────────────────────────────────────

  // GET /alerts/history — all alerts for the current user (paginated)
  fastify.get<{
    Querystring: { limit?: string; before?: string; api_id?: string; type?: string };
  }>(
    '/history',
    async (request, reply) => {
      const limit  = Math.min(parseInt(request.query.limit ?? '50'), 200);
      const before = request.query.before ?? new Date().toISOString();

      let query = `
        SELECT ah.id, ah.api_id, ma.name AS api_name, ah.alert_type,
               ah.triggered_at, ah.resolved_at, ah.details
        FROM alert_history ah
        JOIN monitored_apis ma ON ma.id = ah.api_id
        WHERE ma.user_id = $1
          AND ah.triggered_at < $2::TIMESTAMPTZ
      `;
      const params: unknown[] = [request.user.id, before];

      if (request.query.api_id) {
        params.push(request.query.api_id);
        query += ` AND ah.api_id = $${params.length}`;
      }
      if (request.query.type) {
        params.push(request.query.type);
        query += ` AND ah.alert_type = $${params.length}`;
      }

      params.push(limit);
      query += ` ORDER BY ah.triggered_at DESC LIMIT $${params.length}`;

      const { rows } = await db.query<AlertHistory>(query, params);
      return reply.send({ data: rows, count: rows.length });
    }
  );

  // GET /alerts/history/:apiId — alert history for a specific API
  fastify.get<{
    Params: { apiId: string };
    Querystring: { limit?: string };
  }>(
    '/history/:apiId',
    async (request, reply) => {
      const { rows: apiRows } = await db.query(
        'SELECT id FROM monitored_apis WHERE id = $1 AND user_id = $2',
        [request.params.apiId, request.user.id]
      );
      if (!apiRows.length) return reply.code(404).send({ error: 'API not found' });

      const limit = Math.min(parseInt(request.query.limit ?? '50'), 200);

      const { rows } = await db.query<AlertHistory>(
        `SELECT id, api_id, alert_type, triggered_at, resolved_at, details
         FROM alert_history
         WHERE api_id = $1
         ORDER BY triggered_at DESC
         LIMIT $2`,
        [request.params.apiId, limit]
      );

      return reply.send({ data: rows, count: rows.length });
    }
  );

  // ── Status Pages ───────────────────────────────────────────────────────────

  // GET /alerts/status-pages — list all status pages for current user
  fastify.get('/status-pages', async (request: FastifyRequest, reply: FastifyReply) => {
    const { rows } = await db.query<StatusPage>(
      'SELECT * FROM status_pages WHERE user_id = $1 ORDER BY created_at DESC',
      [request.user.id]
    );
    return reply.send(rows);
  });

  // POST /alerts/status-pages
  fastify.post('/status-pages', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = StatusPageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
    }
    const d = parsed.data;

    // Verify all api_ids belong to this user
    const { rows: owned } = await db.query(
      `SELECT id FROM monitored_apis WHERE id = ANY($1) AND user_id = $2`,
      [d.api_ids, request.user.id]
    );
    if (owned.length !== d.api_ids.length) {
      return reply.code(400).send({ error: 'One or more API IDs are invalid or not owned by you' });
    }

    const { rows } = await db.query<StatusPage>(
      `INSERT INTO status_pages (user_id, slug, title, api_ids, is_public)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [request.user.id, d.slug, d.title, d.api_ids, d.is_public]
    );

    return reply.code(201).send(rows[0]);
  });

  // DELETE /alerts/status-pages/:id
  fastify.delete<{ Params: { id: string } }>(
    '/status-pages/:id',
    async (request, reply) => {
      const { rowCount } = await db.query(
        'DELETE FROM status_pages WHERE id = $1 AND user_id = $2',
        [request.params.id, request.user.id]
      );
      if (!rowCount) return reply.code(404).send({ error: 'Status page not found' });
      return reply.code(204).send();
    }
  );
}

// ─── Public status page route (no auth) ─────────────────────────────────────

export async function publicStatusRoutes(fastify: FastifyInstance) {
  // GET /status/:slug  — publicly accessible, no JWT required
  fastify.get<{ Params: { slug: string } }>(
    '/status/:slug',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { rows: pages } = await db.query<StatusPage>(
        `SELECT * FROM status_pages WHERE slug = $1 AND is_public = TRUE`,
        [request.params.slug]
      );
      if (!pages.length) {
        return reply.code(404).send({ error: 'Status page not found' });
      }
      const page = pages[0];

      // Fetch current state + 24h metrics for each API in the page
      const { rows: apis } = await db.query(
        `SELECT
           ma.id, ma.name, ma.url, ma.state, ma.region,
           COALESCE(
             ROUND(
               100.0 * SUM(hm.successful_checks) / NULLIF(SUM(hm.total_checks), 0),
               2
             ),
             100
           )::float                                                          AS uptime_24h,
           COALESCE(ROUND(AVG(hm.avg_latency_ms)::numeric, 2), 0)::float   AS avg_latency_ms
         FROM monitored_apis ma
         LEFT JOIN hourly_metrics hm
           ON hm.api_id = ma.id AND hm.bucket > NOW() - INTERVAL '24 hours'
         WHERE ma.id = ANY($1)
         GROUP BY ma.id`,
        [page.api_ids]
      );

      return reply.send({
        title:      page.title,
        slug:       page.slug,
        apis,
        generated_at: new Date().toISOString(),
      });
    }
  );
}
