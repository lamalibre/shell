import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteOpts } from '../types.js';
import '../types.js'; // ensure declaration merging is loaded
import { AgentLabelParamSchema } from '../schemas.js';

export default async function agentRoutes(
  fastify: FastifyInstance,
  opts: RouteOpts,
): Promise<void> {
  const { ctx, requireRole } = opts;

  // GET /agents — list all registered agents
  fastify.get('/agents', { preHandler: requireRole(['admin']) }, async () => {
    const agents = await ctx.registry.listAgents();
    return { agents };
  });

  // POST /agents/:label/revoke — revoke an agent (admin-only, standalone mode)
  fastify.post(
    '/agents/:label/revoke',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);

      // Check if agent exists (including already-revoked agents)
      const agents = await ctx.registry.listAgents();
      const agent = agents.find((a) => a.label === label);
      if (!agent) {
        return reply.code(404).send({ error: `Agent "${label}" not found` });
      }

      if (agent.revoked) {
        return reply.code(409).send({ error: `Agent "${label}" is already revoked` });
      }

      // If the agent has an active session, terminate it
      if (fastify.hasActiveSession(label)) {
        const sessionId = fastify.findSessionId(label);
        if (sessionId) {
          await fastify.terminateSession(sessionId);
          request.log.info({ label, sessionId }, 'Terminated active session during agent revocation');
        }
      }

      // Revoke the agent: set revoked=true and clear shell access
      await ctx.registry.updateAgent(label, (a) => {
        a.revoked = true;
        delete a.shellEnabledUntil;
        delete a.shellPolicy;
      });

      request.log.info({ label }, 'Agent revoked');
      return { ok: true, label };
    },
  );
}
