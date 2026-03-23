import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import path from 'node:path';
import os from 'node:os';
import pino from 'pino';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthInfo, ShellContext } from './types.js';
import { StandaloneAgentRegistry } from './lib/registry.js';
import { ensureCa, ensureServerCert, signAgentCsr } from './cert/ca.js';
import { consumeJoinToken, createJoinToken } from './cert/token.js';
import {
  TicketStore,
  SessionStore,
  PanelTicketMap,
  loadTunnelConfig,
} from './lib/tunnel-auth.js';
import { TicketInstanceManager } from '@lamalibre/portlama-tickets';
import { z } from 'zod';
import configRoutes from './routes/config.js';
import policyRoutes from './routes/policies.js';
import enableRoutes from './routes/enable.js';
import sessionRoutes from './routes/sessions.js';
import agentStatusRoutes from './routes/agent-status.js';
import fileRoutes from './routes/files.js';
import agentRoutes from './routes/agents.js';
import shellRelay from './relay.js';

// Augment Fastify request with shellAuth
declare module 'fastify' {
  interface FastifyRequest {
    shellAuth: AuthInfo | null;
  }
}

export interface StandaloneServerOpts {
  port?: number;
  host?: string;
  stateDir?: string;
  tunnelHostname?: string;
}

function resolveStateDir(stateDir?: string): string {
  if (stateDir) return stateDir;
  return path.join(os.homedir(), '.shell');
}

async function ensureApiKey(stateDir: string): Promise<string> {
  const keyPath = path.join(stateDir, 'api-key');
  const key = randomBytes(32).toString('hex');
  try {
    await writeFile(keyPath, key + '\n', { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    return key;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return (await readFile(keyPath, 'utf-8')).trim();
    }
    throw err;
  }
}

export async function startStandaloneServer(opts?: StandaloneServerOpts): Promise<FastifyInstance> {
  const port = opts?.port ?? 9494;
  const host = opts?.host ?? '0.0.0.0';
  const stateDir = resolveStateDir(opts?.stateDir);

  // Temporary logger for the boot phase before Fastify is initialized
  const bootLogger = pino({ name: 'shell-server-boot' });

  // Ensure state directory exists
  await mkdir(stateDir, { recursive: true, mode: 0o700 });

  // Load tunnel config if present
  const tunnelConfig = await loadTunnelConfig(stateDir);
  const tunnelHostname = opts?.tunnelHostname ?? tunnelConfig?.fqdn;

  // Generate CA and server cert (with extra SANs for tunnel hostname)
  const { caCertPem } = await ensureCa(stateDir);
  const extraSANs = tunnelHostname ? [tunnelHostname] : undefined;
  const { certPem, keyPem } = await ensureServerCert(stateDir, extraSANs);
  const apiKey = await ensureApiKey(stateDir);

  // Ticket and session stores for tunnel mode auth — only created when tunnel mode is active
  const ticketStore = tunnelConfig ? new TicketStore() : undefined;
  const sessionStore = tunnelConfig ? new SessionStore() : undefined;

  // Panel ticket map for Portlama ticket system (tunnel mode)
  const panelTicketMap = tunnelConfig ? new PanelTicketMap() : undefined;

  // TicketInstanceManager from SDK — source side (register instance, heartbeat, request tickets)
  let ticketManager: TicketInstanceManager | undefined;

  if (tunnelConfig) {
    ticketManager = new TicketInstanceManager({
      panelUrl: tunnelConfig.panelUrl,
      certs: {
        p12Path: tunnelConfig.portlamaP12Path,
        p12Password: tunnelConfig.portlamaP12Password,
      },
      scope: 'shell:connect',
      transport: {
        strategies: ['tunnel'],
        preferred: 'tunnel',
      },
      logger: bootLogger,
    });

    try {
      await ticketManager.start();
      bootLogger.info(
        { instanceId: ticketManager.getInstanceId() },
        'Ticket instance manager started',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      bootLogger.error({ err: msg }, 'Failed to start ticket instance manager');
      // Non-fatal — server can still run, but ticket flow won't work
    }
  }

  const registry = new StandaloneAgentRegistry(stateDir);

  const ctx: ShellContext = {
    registry,
    stateDir,
    log: null, // Will be set after Fastify creates its logger
  };

  // Create Fastify with HTTPS + optional client cert
  const fastify = Fastify({
    logger: true,
    https: {
      cert: certPem,
      key: keyPem,
      ca: caCertPem,
      requestCert: true,
      rejectUnauthorized: false, // We verify manually — allows both API key and mTLS
    },
  });

  ctx.log = fastify.log;

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

  // Register WebSocket plugin
  await fastify.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  // Decorate request with shellAuth
  fastify.decorateRequest('shellAuth', null);

  // Auth hook
  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0] ?? request.url;

    // Public endpoints
    if (
      url === '/api/shell/health' ||
      url === '/api/shell/enroll' ||
      url.startsWith('/api/shell/agent-ticket/')
    ) {
      return;
    }

    // Check API key (admin auth) or session token (tunnel agent auth)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      // Check session token (tunnel mode — agents auth via ticket-issued sessions)
      if (sessionStore && token.startsWith('session:')) {
        const sessionToken = token.slice(8);
        const session = sessionStore.validate(sessionToken);
        if (session) {
          request.shellAuth = { role: 'agent', label: session.label };
          return;
        }
      }

      // Check API key (admin auth)
      if (token.length === apiKey.length && timingSafeEqual(Buffer.from(token), Buffer.from(apiKey))) {
        request.shellAuth = { role: 'admin', label: null };
        return;
      }
    }

    // Check mTLS client cert (agent auth)
    const tlsSocket = request.raw.socket as TLSSocket;
    if (typeof tlsSocket.getPeerCertificate === 'function') {
      const peerCert = tlsSocket.getPeerCertificate();
      if (
        tlsSocket.authorized &&
        peerCert?.subject?.CN &&
        typeof peerCert.subject.CN === 'string'
      ) {
        const cn = peerCert.subject.CN;
        if (cn.startsWith('agent:')) {
          request.shellAuth = { role: 'agent', label: cn.slice(6) };
          return;
        }
      }
    }

    return reply.code(401).send({ error: 'Authentication required' });
  });

  // Shared auth helpers for routes
  const requireRole = (
    roles: Array<'admin' | 'agent'>,
  ): ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.shellAuth;
      if (!auth) {
        return reply.code(401).send({ error: 'Authentication required' });
      }
      if (!roles.includes(auth.role)) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }
    };
  };

  const getAuth = (request: FastifyRequest): AuthInfo => {
    if (!request.shellAuth) {
      throw new Error('Unauthenticated request reached getAuth');
    }
    return request.shellAuth;
  };

  // Health endpoint (public)
  fastify.get('/api/shell/health', async () => {
    return { status: 'ok' };
  });

  const EnrollBodySchema = z.object({
    token: z.string().min(1).max(256),
    csr: z.string().min(1).max(10000),
  });

  const TokensBodySchema = z.object({
    label: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9-]+$/),
    ttlMinutes: z.number().int().min(1).max(1440).optional(),
  });

  // Enrollment endpoint (public, token-gated)
  fastify.post('/api/shell/enroll', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = EnrollBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const body = parsed.data;

    const consumed = await consumeJoinToken(stateDir, body.token);
    if (!consumed) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    try {
      const agentCertPem = await signAgentCsr(stateDir, body.csr, consumed.label);

      // Add agent to registry
      await registry.addAgent({
        label: consumed.label,
        revoked: false,
      });

      return { cert: agentCertPem, ca: caCertPem, label: consumed.label };
    } catch (err) {
      fastify.log.error(err, 'Failed to sign agent CSR');
      return reply.code(500).send({ error: 'Failed to sign agent certificate' });
    }
  });

  // Token creation endpoint (admin-only)
  fastify.post(
    '/api/shell/tokens',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = TokensBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.message });
      }
      const body = parsed.data;

      const token = await createJoinToken(stateDir, body.label, body.ttlMinutes);
      return token;
    },
  );

  // --- Ticket endpoint (for standalone mode auth) ---

  // POST /api/shell/ticket — admin gets a ticket (only available in tunnel mode)
  fastify.post(
    '/api/shell/ticket',
    { preHandler: requireRole(['admin']) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!ticketStore) {
        return reply.code(404).send({ error: 'Ticket system not available (tunnel mode not active)' });
      }
      const auth = getAuth(request);
      const label = auth.label ?? 'admin';
      return ticketStore.issue(label);
    },
  );

  // Register all shell routes under /api/shell prefix
  const routeOpts = { ctx, requireRole };
  const routeOptsWithAuth = {
    ctx,
    requireRole,
    getAuth,
    ticketStore,
    sessionStore,
    ticketManager,
    panelTicketMap,
  };

  await fastify.register(
    async (scope) => {
      await scope.register(configRoutes, routeOpts);
      await scope.register(policyRoutes, routeOpts);
      await scope.register(enableRoutes, routeOpts);
      await scope.register(sessionRoutes, routeOpts);
      await scope.register(agentStatusRoutes, routeOptsWithAuth);
      await scope.register(fileRoutes, routeOpts);
      await scope.register(agentRoutes, routeOpts);
      await scope.register(shellRelay, routeOptsWithAuth);
    },
    { prefix: '/api/shell' },
  );

  // Clean up ticket manager on close
  fastify.addHook('onClose', async () => {
    if (ticketManager) {
      await ticketManager.stop();
    }
  });

  // Start listening
  await fastify.listen({ port, host });

  const mode = tunnelConfig ? 'tunnel' : 'standalone';
  fastify.log.info(`Shell server listening on https://${host}:${port} (${mode} mode)`);
  if (tunnelConfig) {
    fastify.log.info(`Tunnel FQDN: ${tunnelConfig.fqdn}`);
    if (ticketManager?.isReady()) {
      fastify.log.info(`Panel ticket instance: ${ticketManager.getInstanceId()}`);
    }
  }
  fastify.log.info(`API key stored at ${path.join(stateDir, 'api-key')}`);
  fastify.log.info(`CA certificate at ${path.join(stateDir, 'ca.crt')}`);

  return fastify;
}
