import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { runMigrations } from '@monitor/db';
import { registerAuthDecorator } from './middleware/auth';
import { registerRateLimiter } from './middleware/rateLimiter';
import { authRoutes } from './routes/auth';
import { apisRoutes } from './routes/apis';
import { metricsRoutes } from './routes/metrics';
import { alertsRoutes, publicStatusRoutes } from './routes/alerts';

// ─── Build app (exported for testing) ───────────────────────────────────────

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    // Reject payloads > 1MB
    bodyLimit: 1_048_576,
  });

  // ── Security plugins ─────────────────────────────────────────────────────

  await fastify.register(helmet, {
    contentSecurityPolicy: false, // handled by reverse proxy
  });

  await fastify.register(cors, {
    origin:      process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET!,
    sign:   { algorithm: 'HS256' },
  });

  // ── Rate limiter (must be registered before routes) ──────────────────────

  await registerRateLimiter(fastify);

  // ── Auth decorator (makes fastify.authenticate available) ────────────────

  await registerAuthDecorator(fastify);

  // ── Health check (used by Docker / K8s liveness probe) ───────────────────

  fastify.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', ts: new Date().toISOString() });
  });

  // ── Public routes (no auth) ──────────────────────────────────────────────

  await fastify.register(publicStatusRoutes);

  // ── Auth routes ──────────────────────────────────────────────────────────

  await fastify.register(authRoutes, { prefix: '/auth' });

  // ── Protected API routes ─────────────────────────────────────────────────

  await fastify.register(apisRoutes, { prefix: '/apis' });

  // Metrics are nested under /apis/:id — register with the same prefix
  // so route paths become /apis/:id/metrics, /apis/:id/metrics/hourly, etc.
  await fastify.register(metricsRoutes, { prefix: '/apis' });

  await fastify.register(alertsRoutes, { prefix: '/alerts' });

  // ── Global error handler ─────────────────────────────────────────────────

  fastify.setErrorHandler((error, _request, reply) => {
    fastify.log.error(error);

    // Zod / validation errors already have a structured response shape
    if (error.statusCode === 400) {
      return reply.code(400).send({ error: error.message });
    }

    // JWT errors
    if (error.statusCode === 401) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Postgres unique violation
    if ((error as any).code === '23505') {
      return reply.code(409).send({ error: 'Resource already exists' });
    }

    // Postgres foreign key violation
    if ((error as any).code === '23503') {
      return reply.code(400).send({ error: 'Referenced resource not found' });
    }

    return reply.code(500).send({
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { message: error.message }),
    });
  });

  fastify.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'Route not found' });
  });

  return fastify;
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

async function start() {
  // Validate required env vars before anything else
  const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`[api] Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  // Run DB migrations (idempotent — safe on every boot)
  await runMigrations();

  const app = await buildApp();

  const host = process.env.HOST ?? '0.0.0.0';
  const port = parseInt(process.env.PORT ?? '3000');

  try {
    await app.listen({ host, port });
    console.log(`[api] Listening on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    console.log(`[api] Received ${signal}, shutting down...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start();
