import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteOpts } from '../types.js';
import { readShellConfig, writeShellConfig } from '../lib/shell.js';
import { CreatePolicySchema, UpdatePolicySchema, PolicyIdParamSchema } from '../schemas.js';

/**
 * Derive a slug-style ID from a policy name.
 */
function slugifyPolicyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export default async function policyRoutes(
  fastify: FastifyInstance,
  opts: RouteOpts,
): Promise<void> {
  const { ctx, requireRole } = opts;

  // GET /policies — list all policies
  fastify.get('/policies', { preHandler: requireRole(['admin']) }, async () => {
    const config = await readShellConfig(ctx.stateDir);
    return { policies: config.policies, defaultPolicy: config.defaultPolicy };
  });

  // POST /policies — create a new policy
  fastify.post(
    '/policies',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = CreatePolicySchema.parse(request.body);
      const config = await readShellConfig(ctx.stateDir);

      const policyId = body.id ?? slugifyPolicyName(body.name);
      if (!policyId) {
        return reply.code(400).send({ error: 'Could not derive a valid policy ID from the name' });
      }

      if (config.policies.some((p) => p.id === policyId)) {
        return reply.code(409).send({ error: `A policy with ID "${policyId}" already exists` });
      }

      const newPolicy: import('../types.js').ShellPolicy = {
        id: policyId,
        name: body.name,
        description: body.description,
        allowedIps: body.allowedIps,
        deniedIps: body.deniedIps,
        maxFileSize: body.maxFileSize ?? 100 * 1024 * 1024,
        inactivityTimeout: body.inactivityTimeout ?? 600,
        commandBlocklist: {
          hardBlocked: body.commandBlocklist?.hardBlocked ?? [],
          restricted: body.commandBlocklist?.restricted ?? {},
        },
      };

      config.policies.push(newPolicy);

      try {
        await writeShellConfig(ctx.stateDir, config);
      } catch (err) {
        request.log.error(err, 'Failed to save shell config after creating policy');
        return reply.code(500).send({ error: 'Failed to save policy' });
      }

      request.log.info({ policyId }, 'Shell policy created');
      return { ok: true, policy: newPolicy };
    },
  );

  // PATCH /policies/:policyId — update a policy
  fastify.patch(
    '/policies/:policyId',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { policyId } = PolicyIdParamSchema.parse(request.params);
      const body = UpdatePolicySchema.parse(request.body);
      const config = await readShellConfig(ctx.stateDir);

      const policyIndex = config.policies.findIndex((p) => p.id === policyId);
      if (policyIndex === -1) {
        return reply.code(404).send({ error: `Policy "${policyId}" not found` });
      }

      const existing = config.policies[policyIndex]!;

      if (body.name !== undefined) existing.name = body.name;
      if (body.description !== undefined) existing.description = body.description;
      if (body.allowedIps !== undefined) existing.allowedIps = body.allowedIps;
      if (body.deniedIps !== undefined) existing.deniedIps = body.deniedIps;
      if (body.maxFileSize !== undefined) existing.maxFileSize = body.maxFileSize;
      if (body.inactivityTimeout !== undefined) existing.inactivityTimeout = body.inactivityTimeout;
      if (body.commandBlocklist) {
        if (body.commandBlocklist.hardBlocked !== undefined) {
          existing.commandBlocklist.hardBlocked = body.commandBlocklist.hardBlocked;
        }
        if (body.commandBlocklist.restricted !== undefined) {
          existing.commandBlocklist.restricted = {
            ...existing.commandBlocklist.restricted,
            ...body.commandBlocklist.restricted,
          };
        }
      }

      config.policies[policyIndex] = existing;

      try {
        await writeShellConfig(ctx.stateDir, config);
      } catch (err) {
        request.log.error(err, 'Failed to save shell config after updating policy');
        return reply.code(500).send({ error: 'Failed to save policy' });
      }

      request.log.info({ policyId }, 'Shell policy updated');
      return { ok: true, policy: existing };
    },
  );

  // DELETE /policies/:policyId — delete a policy
  fastify.delete(
    '/policies/:policyId',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { policyId } = PolicyIdParamSchema.parse(request.params);
      const config = await readShellConfig(ctx.stateDir);

      if (config.defaultPolicy === policyId) {
        return reply.code(400).send({
          error: `Cannot delete the default policy "${policyId}". Change the default policy first.`,
        });
      }

      const policyIndex = config.policies.findIndex((p) => p.id === policyId);
      if (policyIndex === -1) {
        return reply.code(404).send({ error: `Policy "${policyId}" not found` });
      }

      // Check if any active agent is currently using this policy
      const agents = await ctx.registry.listAgents();
      const agentsUsingPolicy = agents.filter(
        (a) => !a.revoked && a.shellPolicy === policyId && a.shellEnabledUntil,
      );

      if (agentsUsingPolicy.length > 0) {
        const labels = agentsUsingPolicy.map((a) => a.label).join(', ');
        return reply.code(400).send({
          error: `Cannot delete policy "${policyId}" — it is currently assigned to agents: ${labels}`,
        });
      }

      config.policies.splice(policyIndex, 1);

      try {
        await writeShellConfig(ctx.stateDir, config);
      } catch (err) {
        request.log.error(err, 'Failed to save shell config after deleting policy');
        return reply.code(500).send({ error: 'Failed to delete policy' });
      }

      request.log.info({ policyId }, 'Shell policy deleted');
      return { ok: true };
    },
  );
}
