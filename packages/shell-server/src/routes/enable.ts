import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteOpts } from '../types.js';
import { readShellConfig, enableAgentShell, disableAgentShell } from '../lib/shell.js';
import { AgentLabelParamSchema, EnableShellSchema } from '../schemas.js';

export default async function enableRoutes(
  fastify: FastifyInstance,
  opts: RouteOpts,
): Promise<void> {
  const { ctx, requireRole } = opts;

  // POST /enable/:label — enable shell access for an agent
  fastify.post(
    '/enable/:label',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);
      const { durationMinutes, policyId } = EnableShellSchema.parse(request.body ?? {});

      const config = await readShellConfig(ctx.stateDir);
      if (!config.enabled) {
        return reply.code(400).send({
          error: 'Remote shell is not enabled globally. Enable it in Settings first.',
        });
      }

      if (policyId && !config.policies.some((p) => p.id === policyId)) {
        return reply.code(400).send({
          error: `Policy "${policyId}" does not exist`,
        });
      }

      try {
        const result = await enableAgentShell(ctx, label, durationMinutes, policyId);
        request.log.info(
          { label, durationMinutes, policyId: result.shellPolicy },
          'Shell access enabled for agent',
        );
        return result;
      } catch (err) {
        const shellErr = err as { statusCode?: number; message: string };
        if (shellErr.statusCode) {
          return reply.code(shellErr.statusCode).send({ error: shellErr.message });
        }
        request.log.error(err, 'Failed to enable shell access');
        return reply.code(500).send({ error: 'Failed to enable shell access' });
      }
    },
  );

  // DELETE /enable/:label — disable shell access for an agent
  fastify.delete(
    '/enable/:label',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { label } = AgentLabelParamSchema.parse(request.params);

      try {
        const result = await disableAgentShell(ctx, label);
        request.log.info({ label }, 'Shell access disabled for agent');
        return result;
      } catch (err) {
        const shellErr = err as { statusCode?: number; message: string };
        if (shellErr.statusCode) {
          return reply.code(shellErr.statusCode).send({ error: shellErr.message });
        }
        request.log.error(err, 'Failed to disable shell access');
        return reply.code(500).send({ error: 'Failed to disable shell access' });
      }
    },
  );
}
