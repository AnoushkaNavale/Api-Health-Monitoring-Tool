import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

/**
 * Global rate limiter.
 * Different route groups can override these defaults via
 * { config: { rateLimit: { max: N, timeWindow: '...' } } }
 */
export async function registerRateLimiter(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    // Key by user ID when authenticated, fall back to IP
    keyGenerator(request) {
      return (request.user as any)?.id ?? request.ip;
    },
    errorResponseBuilder(_request, context) {
      return {
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry after ${context.after}.`,
        retryAfter: context.after,
      };
    },
  });
}
