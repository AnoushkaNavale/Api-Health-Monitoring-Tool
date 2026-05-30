import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@monitor/db';
import type { User } from '@monitor/types';

// ─── Validation schemas ─────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// ─── Route plugin ───────────────────────────────────────────────────────────

export async function authRoutes(fastify: FastifyInstance) {

  // POST /auth/register
  fastify.post(
    '/register',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = RegisterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
      }
      const { email, password } = parsed.data;

      // Prevent timing-safe enumeration — hash before checking existence
      const hash = await bcrypt.hash(password, 12);

      const existing = await db.query<User>(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      if (existing.rows.length > 0) {
        return reply.code(409).send({ error: 'Email already in use' });
      }

      const { rows } = await db.query<User>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email, plan, created_at`,
        [email, hash]
      );

      const user = rows[0];
      const token = fastify.jwt.sign(
        { id: user.id, email: user.email },
        { expiresIn: '7d' }
      );

      return reply.code(201).send({ token, user: { id: user.id, email: user.email, plan: user.plan } });
    }
  );

  // POST /auth/login
  fastify.post(
    '/login',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = LoginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', issues: parsed.error.issues });
      }
      const { email, password } = parsed.data;

      const { rows } = await db.query<User>(
        'SELECT id, email, password_hash, plan FROM users WHERE email = $1',
        [email]
      );

      // Always run bcrypt.compare to prevent timing attacks, even on missing user
      const fakeHash = '$2b$12$invalidhashfortimingnormalization000000000000';
      const user = rows[0];
      const valid = await bcrypt.compare(password, user?.password_hash ?? fakeHash);

      if (!user || !valid) {
        return reply.code(401).send({ error: 'Invalid email or password' });
      }

      const token = fastify.jwt.sign(
        { id: user.id, email: user.email },
        { expiresIn: '7d' }
      );

      return reply.send({ token, user: { id: user.id, email: user.email, plan: user.plan } });
    }
  );

  // GET /auth/me  (protected)
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { rows } = await db.query<User>(
        'SELECT id, email, plan, created_at FROM users WHERE id = $1',
        [request.user.id]
      );
      if (!rows.length) return reply.code(404).send({ error: 'User not found' });
      return reply.send(rows[0]);
    }
  );
}
