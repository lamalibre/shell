import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteOptsWithAuth } from '../types.js';
import { readShellConfig, isAgentShellEnabled } from '../lib/shell.js';

export default async function agentStatusRoutes(
  fastify: FastifyInstance,
  opts: RouteOptsWithAuth,
): Promise<void> {
  const { ctx, requireRole, getAuth } = opts;

  // GET /agent-status — agent checks its own shell enabled status
  fastify.get(
    '/agent-status',
    { preHandler: requireRole(['admin', 'agent']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = getAuth(request);
      const label =
        auth.role === 'agent'
          ? auth.label
          : (request.query as Record<string, string | undefined>)?.['label'];

      if (!label) {
        return reply.code(400).send({ error: 'Missing agent label' });
      }

      const config = await readShellConfig(ctx.stateDir);
      const agent = await ctx.registry.findNonRevokedAgent(label);

      if (!agent) {
        return reply.code(404).send({ error: `Agent certificate "${label}" not found` });
      }

      const shellEnabled = isAgentShellEnabled(agent);
      const policyId = agent.shellPolicy ?? config.defaultPolicy;
      const policy = config.policies.find((p) => p.id === policyId);

      return {
        label,
        globalEnabled: config.enabled,
        shellEnabled,
        shellEnabledUntil: agent.shellEnabledUntil ?? null,
        policyId,
        commandBlocklist: policy?.commandBlocklist ?? null,
      };
    },
  );
}
