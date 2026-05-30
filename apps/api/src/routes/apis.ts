import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '@monitor/db';
import { getHealthCheckQueue } from '@monitor/queue';
import type { MonitoredApi, CreateApiRequest, UpdateApiRequest } from '@monitor/types';

// ─── Validation schemas ─────────────────────────────────────────────────────

const CreateApiSchema = z.object({
  name:            z.string().min(1).max(100),
  url:             z.string().url(),
  method:          z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers:         z.record(z.string()).default({}),
  body:            z.string().optional(),
  expected_status: z.number().int().min(100).max(599).default(200),
  timeout_ms:      z.number().int().min(500).max(30000).default(5000),
  interval_sec:    z.number().int().min(10).default(60),
  tags:            z.array(z.string()).default([]),
  region:          z.string().default('us-east'),
});

const UpdateApiSchema = CreateApiSchema.partial().extend({
  is_active: z.boolean().optional(),
});

// ─── Helper: assert ownership ────────────────────────────────────────────────

async function assertOwnership(apiId: string, userId: string, reply: FastifyReply): Promise<MonitoredApi | null> {
  const { rows } = await db.query<MonitoredApi>(
    'SELECT * FROM monitored_apis WHERE id = $1 AND user_id = $2',
    [apiId, userId]
  );
  if (!rows.length) {
    reply.code(404).send({ error: 'API not found' });
    return null;
  }
  return rows[0];
}

// ─── Route plugin ───────────────────────────────────────────────────────────

export async function apisRoutes(fastify: FastifyInstance) {
  // All routes in this plugin require auth
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /apis — list all APIs owned by the current user
  fastify.get('/', async (request: FastifyRequest<{ Querystring: { tag?: string; state?: string; region?: string } }>, reply) => {
    const { tag, state, region } = request.query;

    let query = `
      SELECT id, name, url, method, expected_status, timeout_ms,
             interval_sec, tags, region, is_active, state,
             consecutive_failures, created_at, updated_at
      FROM monitored_apis
      WHERE user_id = $1
    `;
    const params: unknown[] = [request.user.id];

    if (tag) {
      params.push(tag);
      query += ` AND $${params.length} = ANY(tags)`;
    }
    if (state) {
      params.push(state);
      query += ` AND state = $${params.length}`;
    }
    if (region) {
      params.push(region);
      query += ` AND region = $${params.length}`;
    }

    query += ' ORDER BY created_at DESC';

    const { rows } = await db.query<MonitoredApi>(query, params);
    return reply.send(rows);
  });

  // GET /apis/:id — single API detail
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const api = await assertOwnership(request.params.id, request.user.id, reply);
      if (!api) return;
      return reply.send(api);
    }
  );

  // POST /apis — create a new monitored API
  fastify.post(
    '/',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CreateApiSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
      }
      const data: CreateApiRequest = parsed.data;

      const { rows } = await db.query<MonitoredApi>(
        `INSERT INTO monitored_apis
           (user_id, name, url, method, headers, body, expected_status,
            timeout_ms, interval_sec, tags, region)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          request.user.id, data.name, data.url, data.method,
          JSON.stringify(data.headers), data.body ?? null,
          data.expected_status, data.timeout_ms, data.interval_sec,
          data.tags, data.region,
        ]
      );

      const api = rows[0];

      // Trigger an immediate first check
      await getHealthCheckQueue().add(
        'health-check',
        { apiId: api.id, region: api.region, userId: request.user.id },
        { priority: 2 }
      );

      return reply.code(201).send(api);
    }
  );

  // PATCH /apis/:id — partial update
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const api = await assertOwnership(request.params.id, request.user.id, reply);
      if (!api) return;

      const parsed = UpdateApiSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
      }
      const data: UpdateApiRequest = parsed.data;

      // Build dynamic SET clause (only update provided fields)
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      const fieldMap: Record<string, unknown> = {
        name:            data.name,
        url:             data.url,
        method:          data.method,
        headers:         data.headers ? JSON.stringify(data.headers) : undefined,
        body:            data.body,
        expected_status: data.expected_status,
        timeout_ms:      data.timeout_ms,
        interval_sec:    data.interval_sec,
        tags:            data.tags,
        region:          data.region,
        is_active:       data.is_active,
      };

      for (const [col, val] of Object.entries(fieldMap)) {
        if (val !== undefined) {
          fields.push(`${col} = $${i++}`);
          values.push(val);
        }
      }

      if (!fields.length) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      values.push(request.params.id);
      const { rows } = await db.query<MonitoredApi>(
        `UPDATE monitored_apis SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
        values
      );

      // If interval changed, the scheduler will pick it up on its next sync cycle.
      // If toggled to active, trigger an immediate check.
      if (data.is_active === true && !api.is_active) {
        await getHealthCheckQueue().add(
          'health-check',
          { apiId: api.id, region: rows[0].region, userId: request.user.id },
          { priority: 2 }
        );
      }

      return reply.send(rows[0]);
    }
  );

  // DELETE /apis/:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const api = await assertOwnership(request.params.id, request.user.id, reply);
      if (!api) return;

      await db.query('DELETE FROM monitored_apis WHERE id = $1', [request.params.id]);
      // Scheduler will drop the repeatable job on next sync cycle
      return reply.code(204).send();
    }
  );

  // GET /apis/:id/status — latest check + current state snapshot
  fastify.get<{ Params: { id: string } }>(
    '/:id/status',
    async (request, reply) => {
      const api = await assertOwnership(request.params.id, request.user.id, reply);
      if (!api) return;

      const { rows } = await db.query(
        `SELECT status_code, response_ms, is_success, error_message, checked_at, region
         FROM health_checks
         WHERE api_id = $1
         ORDER BY checked_at DESC
         LIMIT 10`,
        [request.params.id]
      );

      return reply.send({ state: api.state, recent_checks: rows });
    }
  );
}
