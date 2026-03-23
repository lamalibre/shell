/**
 * Factory function for mounting shell-server as a Portlama plugin or local host plugin.
 *
 * The local plugin host calls:
 * ```ts
 * import { buildPlugin } from '@lamalibre/shell-server';
 * await app.register(buildPlugin(), { prefix: '/shell', pluginDir, logger });
 * ```
 *
 * This adapts the local host's `pluginDir` + `logger` options into the
 * `ShellPluginOpts` that shellPlugin expects, using a file-based
 * StandaloneAgentRegistry for agent state.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import shellPluginDefault from './plugin.js';
import { StandaloneAgentRegistry, type PortlamaAgent } from './lib/registry.js';

interface LocalHostOpts {
  pluginDir?: string;
  logger?: unknown;
}

/**
 * Build a Fastify plugin that registers all shell-server routes.
 *
 * When called with no arguments, returns a plugin function compatible with
 * the local plugin host and Portlama panel server.
 */
export function buildPlugin(): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (
    app: FastifyInstance,
    opts: LocalHostOpts,
  ): Promise<void> => {
    const stateDir = opts.pluginDir ?? path.join(process.env['HOME'] ?? '/tmp', '.shell');
    await mkdir(stateDir, { recursive: true, mode: 0o700 });

    const registry = new StandaloneAgentRegistry(stateDir);

    // In local mode, localhost IS the trust boundary — grant admin role
    // to all requests (same as standalone mode with API key auth).
    app.addHook('onRequest', async (request) => {
      const req = request as unknown as { certRole?: string; certLabel?: string };
      if (!req.certRole) {
        req.certRole = 'admin';
      }
    });

    await app.register(shellPluginDefault, {
      stateDir,
      loadAgentRegistry: async () => ({ agents: [...await registry.listAgents()] as PortlamaAgent[] }),
      saveAgentRegistry: async () => {
        // StandaloneAgentRegistry persists on mutation — no-op here
      },
      logger: app.log,
    });
  };

  return plugin;
}
