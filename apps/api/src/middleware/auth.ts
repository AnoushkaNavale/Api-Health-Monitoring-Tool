import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

type AuthUser = {
  id: string;
  email: string;
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

/**
 * Registers fastify.authenticate as a preHandler hook.
 * Usage in routes:  { preHandler: [fastify.authenticate] }
 */
export async function registerAuthDecorator(fastify: FastifyInstance) {
  fastify.decorate(
    'authenticate',
    async function authenticate(request: FastifyRequest, reply: FastifyReply) {
      try {
        // @fastify/jwt attaches jwtVerify to the request
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or missing token' });
      }
    }
  );
}
