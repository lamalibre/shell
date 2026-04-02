import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { AuthInfo, ShellContext } from './types.js';
import { DelegatingAgentRegistry, type PortlamaAgent } from './lib/registry.js';
import configRoutes from './routes/config.js';
import policyRoutes from './routes/policies.js';
import enableRoutes from './routes/enable.js';
import sessionRoutes from './routes/sessions.js';
import agentStatusRoutes from './routes/agent-status.js';
import fileRoutes from './routes/files.js';
import agentRoutes from './routes/agents.js';
import shellRelay from './relay.js';
import { createJoinToken } from './cert/token.js';

export interface ShellPluginOpts {
  stateDir: string;
  loadAgentRegistry: () => Promise<{ agents: PortlamaAgent[] }>;
  saveAgentRegistry: (data: { agents: PortlamaAgent[] }) => Promise<void>;
  logger?: FastifyBaseLogger;
}

async function shellPlugin(fastify: FastifyInstance, opts: ShellPluginOpts): Promise<void> {
  const registry = new DelegatingAgentRegistry(opts.loadAgentRegistry, opts.saveAgentRegistry);

  const ctx: ShellContext = {
    registry,
    stateDir: opts.stateDir,
    log: opts.logger ?? fastify.log,
  };

  // In plugin mode, Portlama's mTLS middleware has already set
  // request.certRole and request.certLabel on the request.
  const requireRole = (
    roles: Array<'admin' | 'agent'>,
  ): ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as unknown as { certRole?: string };
      const role = req.certRole;
      if (role === 'admin') return;
      if (!role || !roles.includes(role as 'admin' | 'agent')) {
        return reply.code(403).send({ error: 'Insufficient certificate scope' });
      }
    };
  };

  const getAuth = (request: FastifyRequest): AuthInfo => {
    const req = request as unknown as { certRole?: string; certLabel?: string };
    const role = req.certRole;
    if (!role || (role !== 'admin' && role !== 'agent')) {
      throw new Error('Missing or invalid certificate role on request');
    }
    return {
      role,
      label: req.certLabel ?? null,
    };
  };

  // Return clean 400 responses for Zod validation errors
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: 'Validation failed',
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    reply.send(error);
  });

  // Ensure @fastify/websocket is available
  if (!fastify.hasDecorator('websocketServer')) {
    const ws = await import('@fastify/websocket');
    await fastify.register(ws.default, { options: { maxPayload: 1024 * 1024 } });
  }

  const routeOpts = { ctx, requireRole };
  const routeOptsWithAuth = { ctx, requireRole, getAuth };

  await fastify.register(configRoutes, routeOpts);
  await fastify.register(policyRoutes, routeOpts);
  await fastify.register(enableRoutes, routeOpts);
  await fastify.register(sessionRoutes, routeOpts);
  await fastify.register(agentStatusRoutes, routeOptsWithAuth);
  await fastify.register(fileRoutes, routeOpts);
  await fastify.register(agentRoutes, routeOpts);

  // Health endpoint (public, no auth required)
  fastify.get('/health', async () => {
    return { status: 'ok' };
  });

  // Token creation endpoint (admin-only — needed by panel microfrontend)
  const TokensBodySchema = z.object({
    label: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
    ttlMinutes: z.number().int().min(1).max(1440).optional(),
  });

  fastify.post(
    '/tokens',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = TokensBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.message });
      }
      const token = await createJoinToken(opts.stateDir, parsed.data.label, parsed.data.ttlMinutes);
      return token;
    },
  );

  await fastify.register(shellRelay, routeOptsWithAuth);
}

export default fp(shellPlugin, { name: 'shell-server' });
