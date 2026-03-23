import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteOpts } from '../types.js';
import { readShellConfig, writeShellConfig } from '../lib/shell.js';
import { UpdateShellConfigSchema } from '../schemas.js';

export default async function configRoutes(
  fastify: FastifyInstance,
  opts: RouteOpts,
): Promise<void> {
  const { ctx, requireRole } = opts;

  // GET /config — get shell configuration
  fastify.get('/config', { preHandler: requireRole(['admin']) }, async () => {
    return readShellConfig(ctx.stateDir);
  });

  // PATCH /config — update shell configuration (enabled + defaultPolicy only)
  fastify.patch(
    '/config',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = UpdateShellConfigSchema.parse(request.body);
      const current = await readShellConfig(ctx.stateDir);

      if (body.enabled !== undefined) current.enabled = body.enabled;

      if (body.defaultPolicy !== undefined) {
        const policyExists = current.policies.some((p) => p.id === body.defaultPolicy);
        if (!policyExists) {
          return reply.code(400).send({
            error: `Policy "${body.defaultPolicy}" does not exist`,
          });
        }
        current.defaultPolicy = body.defaultPolicy;
      }

      try {
        await writeShellConfig(ctx.stateDir, current);
      } catch (err) {
        request.log.error(err, 'Failed to save shell config');
        return reply.code(500).send({ error: 'Failed to save shell configuration' });
      }

      return { ok: true, config: current };
    },
  );
}
