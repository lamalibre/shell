import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import type {
  ShellContext,
  AuthInfo,
  ShellSessionEntry,
  TerminateSessionFn,
  HasActiveSessionFn,
  FindSessionIdFn,
  SendFileRequestFn,
  SendFileUploadFn,
} from './types.js';
import {
  readShellConfig,
  isAgentShellEnabled,
  logShellSession,
  updateShellSession,
} from './lib/shell.js';
import { isIpAllowed } from './lib/ip.js';
import { extractSourceIp } from './lib/request-utils.js';
import { AgentLabelParamSchema } from './schemas.js';
import type { TicketStore, SessionStore, PanelTicketMap } from './lib/tunnel-auth.js';
import type { TicketInstanceManager } from '@lamalibre/portlama-tickets';
import { createRecordingStream, closeRecordingStream, type RecordingStream } from './lib/recordings.js';

// --- Internal types ---

interface PendingAdmin {
  socket: WebSocket;
  request: FastifyRequest;
  sessionEntry: ShellSessionEntry;
  timeout: ReturnType<typeof setTimeout>;
  panelTicketId?: string | undefined;
}

interface ActiveSession {
  adminSocket: WebSocket;
  agentSocket: WebSocket;
  sessionEntry: ShellSessionEntry;
  timeWindowCheck: ReturnType<typeof setInterval>;
  recording: RecordingStream | null;
  terminated: boolean;
}

/** Pending file request waiting for agent response. */
interface PendingFileRequest {
  resolve: (result: { data: string } | { error: string }) => void;
  timeout: ReturnType<typeof setTimeout>;
  label: string;
}

export interface RelayOpts {
  ctx: ShellContext;
  requireRole: (
    roles: Array<'admin' | 'agent'>,
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  getAuth: (request: FastifyRequest) => AuthInfo;
  ticketStore?: TicketStore | undefined;
  sessionStore?: SessionStore | undefined;
  ticketManager?: TicketInstanceManager | undefined;
  panelTicketMap?: PanelTicketMap | undefined;
}

export default async function shellRelay(fastify: FastifyInstance, opts: RelayOpts): Promise<void> {
  const { ctx, requireRole, getAuth, ticketStore, sessionStore, ticketManager, panelTicketMap } = opts;

  // In-memory state for connection pairing
  const pendingAdminConnections = new Map<string, PendingAdmin>();
  const connectedAgents = new Map<string, WebSocket>();
  const activeSessions = new Map<string, ActiveSession>();

  // Pending file requests keyed by requestId
  const pendingFileRequests = new Map<string, PendingFileRequest>();

  // --- Auth gates ---

  /**
   * Run the 5-gate auth chain for an admin shell connection.
   */
  async function runAdminAuthGates(
    request: FastifyRequest,
    label: string,
  ): Promise<
    | {
        ok: true;
        agent: { label: string };
        config: { enabled: boolean };
        policy: { allowedIps: string[]; deniedIps: string[]; commandBlocklist?: { hardBlocked: string[]; restricted: Record<string, boolean> } };
      }
    | { ok: false; code: number; error: string }
  > {
    const auth = getAuth(request);

    // Gate 1: Connecting cert is admin role
    if (auth.role !== 'admin') {
      return { ok: false, code: 4403, error: 'Admin certificate required' };
    }

    // Gate 2: Global shell enabled
    const config = await readShellConfig(ctx.stateDir);
    if (!config.enabled) {
      return { ok: false, code: 4400, error: 'Remote shell is not enabled globally' };
    }

    // Gate 3: Agent cert exists and not revoked
    const agent = await ctx.registry.findNonRevokedAgent(label);
    if (!agent) {
      return { ok: false, code: 4404, error: `Agent certificate "${label}" not found` };
    }

    // Gate 4: Agent's shellEnabledUntil is in the future
    if (!isAgentShellEnabled(agent)) {
      return {
        ok: false,
        code: 4403,
        error: `Shell access not enabled for agent "${label}"`,
      };
    }

    // Resolve the agent's assigned policy
    const policyId = agent.shellPolicy ?? config.defaultPolicy;
    const policy = config.policies.find((p) => p.id === policyId);
    if (!policy) {
      return { ok: false, code: 4500, error: `Policy "${policyId}" not found` };
    }

    // Gate 5: Admin's source IP passes the policy's allow/deny list
    const sourceIp = extractSourceIp(request);
    if (!isIpAllowed(sourceIp, policy.allowedIps, policy.deniedIps)) {
      return { ok: false, code: 4403, error: 'Source IP is not allowed' };
    }

    return { ok: true, agent, config, policy };
  }

  // --- File request helpers ---

  /**
   * Try to parse a WebSocket message as an agent control message (file-response or file-upload-response)
   * and resolve the corresponding pending request. Parses JSON once and dispatches by type.
   * Returns true if the message was consumed, false otherwise.
   */
  function tryHandleAgentControlMessage(data: RawData, log: FastifyBaseLogger): boolean {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return false;
    }

    const type = msg['type'];
    if (type !== 'file-response' && type !== 'file-upload-response') {
      return false;
    }

    if (typeof msg['requestId'] !== 'string') {
      return false;
    }

    const requestId = msg['requestId'];
    const pending = pendingFileRequests.get(requestId);
    if (!pending) {
      log.warn({ requestId, type }, 'Received agent control message for unknown requestId');
      return true; // consumed but orphaned
    }

    pendingFileRequests.delete(requestId);
    clearTimeout(pending.timeout);

    if (typeof msg['error'] === 'string') {
      pending.resolve({ error: msg['error'] });
    } else if (type === 'file-response') {
      if (typeof msg['data'] === 'string') {
        pending.resolve({ data: msg['data'] });
      } else {
        pending.resolve({ error: 'Invalid file-response from agent' });
      }
    } else {
      // file-upload-response success
      pending.resolve({ data: 'ok' });
    }

    return true;
  }

  // --- Socket pairing ---

  /**
   * Pair an admin and agent WebSocket for bidirectional relay.
   */
  async function pairSockets(
    label: string,
    adminSocket: WebSocket,
    agentSocket: WebSocket,
    sessionEntry: ShellSessionEntry,
    log: FastifyBaseLogger,
  ): Promise<void> {
    // Start recording stream (best-effort — don't block session on recording failures)
    let recording: RecordingStream | null = null;
    try {
      recording = await createRecordingStream(ctx.stateDir, label, sessionEntry.id);
      log.info({ label, sessionId: sessionEntry.id }, 'Recording stream started');
    } catch (err) {
      log.error({ err, label, sessionId: sessionEntry.id }, 'Failed to create recording stream');
    }

    // Cleanup function shared by both sides
    async function endSession(initiator: string): Promise<void> {
      const session = activeSessions.get(label);
      if (!session || session.terminated) return;
      session.terminated = true;
      clearInterval(session.timeWindowCheck);
      activeSessions.delete(label);
      connectedAgents.delete(label);
      pendingAdminConnections.delete(label);

      // Close recording stream
      await closeRecordingStream(session.recording);

      // Reject pending file requests associated with this session's agent
      for (const [requestId, pending] of pendingFileRequests) {
        if (pending.label === label) {
          clearTimeout(pending.timeout);
          pending.resolve({ error: 'Session ended' });
          pendingFileRequests.delete(requestId);
        }
      }

      log.info({ label, initiator }, 'Shell relay session ended');

      try {
        if (initiator !== 'admin' && adminSocket.readyState === 1) {
          adminSocket.close(1000, 'Agent disconnected');
        }
      } catch {
        /* already closed */
      }

      try {
        if (initiator !== 'agent' && agentSocket.readyState === 1) {
          agentSocket.close(1000, 'Admin disconnected');
        }
      } catch {
        /* already closed */
      }

      // Update session audit log
      if (sessionEntry.id) {
        try {
          const endedAt = new Date().toISOString();
          const duration = Math.round(
            (new Date(endedAt).getTime() - new Date(sessionEntry.startedAt).getTime()) / 1000,
          );
          await updateShellSession(ctx.stateDir, sessionEntry.id, {
            status: 'ended',
            endedAt,
            duration,
          });
        } catch (err) {
          log.error({ err, label }, 'Failed to update session audit log on close');
        }
      }
    }

    // Register close and error handlers FIRST — before any send() or message handlers,
    // so that early close/error events are never missed.
    adminSocket.on('close', () => void endSession('admin'));
    adminSocket.on('error', (err) => {
      log.error({ err, label }, 'Admin WebSocket error in shell relay');
      void endSession('admin');
    });

    agentSocket.on('close', () => void endSession('agent'));
    agentSocket.on('error', (err) => {
      log.error({ err, label }, 'Agent WebSocket error in shell relay');
      void endSession('agent');
    });

    // Periodic check: enforce shellEnabledUntil during active sessions
    const timeWindowCheck = setInterval(async () => {
      try {
        const agent = await ctx.registry.findNonRevokedAgent(label);
        if (!agent || !isAgentShellEnabled(agent)) {
          log.info({ label }, 'Shell time window expired during active session');
          const expiredMsg = JSON.stringify({ type: 'time-window-expired' });
          try {
            if (adminSocket.readyState === 1) adminSocket.send(expiredMsg);
          } catch {
            /* socket may be closed */
          }
          try {
            if (agentSocket.readyState === 1) agentSocket.send(expiredMsg);
          } catch {
            /* socket may be closed */
          }
          try {
            if (adminSocket.readyState === 1) adminSocket.close(4403, 'Shell time window expired');
          } catch {
            /* already closed */
          }
          try {
            if (agentSocket.readyState === 1) agentSocket.close(4403, 'Shell time window expired');
          } catch {
            /* already closed */
          }
        }
      } catch (err) {
        log.error({ err, label }, 'Error checking shell time window during active session');
      }
    }, 30_000);

    // Mark session as active and store for cleanup (including interval for onClose hook)
    sessionEntry.status = 'active';
    activeSessions.set(label, { adminSocket, agentSocket, sessionEntry, timeWindowCheck, recording, terminated: false });

    // Notify both sides
    try {
      adminSocket.send(
        JSON.stringify({ type: 'connected', message: 'Agent connected, shell relay active' }),
      );
    } catch {
      /* socket may have closed */
    }

    try {
      agentSocket.send(
        JSON.stringify({
          type: 'admin-connected',
          message: 'Admin connected, shell relay active',
        }),
      );
    } catch {
      /* socket may have closed */
    }

    // Admin -> Agent relay
    adminSocket.on('message', (data: RawData) => {
      try {
        if (agentSocket.readyState === 1) {
          agentSocket.send(data);
        }
      } catch (err) {
        log.error({ err, label }, 'Error forwarding admin frame to agent');
      }
    });

    // Agent -> Admin relay (with recording capture and file-response interception)
    agentSocket.on('message', (data: RawData) => {
      try {
        // Check if this is a file-response or file-upload-response control message
        if (tryHandleAgentControlMessage(data, log)) {
          return; // consumed — do not forward to admin
        }

        // Record agent output frames
        if (recording) {
          try {
            const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
            recording.write(buf);
          } catch {
            /* best-effort recording */
          }
        }

        if (adminSocket.readyState === 1) {
          adminSocket.send(data);
        }
      } catch (err) {
        log.error({ err, label }, 'Error forwarding agent frame to admin');
      }
    });
  }

  // --- Exported functions for routes ---

  /**
   * Terminate an active session by session ID.
   * Closes both WebSocket connections with code 4410.
   */
  const terminateSession: TerminateSessionFn = async (sessionId: string): Promise<boolean> => {
    // Find the active session by sessionId
    let targetLabel: string | undefined;
    for (const [label, session] of activeSessions) {
      if (session.sessionEntry.id === sessionId) {
        targetLabel = label;
        break;
      }
    }

    if (!targetLabel) return false;

    const session = activeSessions.get(targetLabel);
    if (!session) return false;

    session.terminated = true;
    clearInterval(session.timeWindowCheck);
    activeSessions.delete(targetLabel);
    connectedAgents.delete(targetLabel);
    pendingAdminConnections.delete(targetLabel);

    // Close recording stream
    await closeRecordingStream(session.recording);

    // Reject pending file requests associated with this session's agent
    for (const [requestId, pending] of pendingFileRequests) {
      if (pending.label === targetLabel) {
        clearTimeout(pending.timeout);
        pending.resolve({ error: 'Session terminated by admin' });
        pendingFileRequests.delete(requestId);
      }
    }

    const reason = 'session-terminated-by-admin';

    try {
      if (session.adminSocket.readyState === 1) {
        session.adminSocket.close(4410, reason);
      }
    } catch {
      /* already closed */
    }

    try {
      if (session.agentSocket.readyState === 1) {
        session.agentSocket.close(4410, reason);
      }
    } catch {
      /* already closed */
    }

    // Update session audit log
    try {
      const endedAt = new Date().toISOString();
      const duration = Math.round(
        (new Date(endedAt).getTime() - new Date(session.sessionEntry.startedAt).getTime()) / 1000,
      );
      await updateShellSession(ctx.stateDir, sessionId, {
        status: 'terminated',
        endedAt,
        duration,
      });
    } catch {
      /* best effort */
    }

    return true;
  };

  /**
   * Check if an agent has an active session.
   */
  const hasActiveSession: HasActiveSessionFn = (label: string): boolean => {
    return activeSessions.has(label);
  };

  /**
   * Find the session ID for an active session by agent label.
   */
  const findSessionId: FindSessionIdFn = (label: string): string | undefined => {
    return activeSessions.get(label)?.sessionEntry.id;
  };

  /**
   * Send a file request to an agent and wait for the response.
   * The agent must have an active session (WebSocket connected).
   */
  const sendFileRequest: SendFileRequestFn = async (
    label: string,
    filePath: string,
    requestId: string,
  ): Promise<string> => {
    const session = activeSessions.get(label);
    if (!session) {
      throw new Error('No active session for this agent');
    }

    if (session.agentSocket.readyState !== 1) {
      throw new Error('Agent WebSocket is not open');
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingFileRequests.delete(requestId);
        reject(new Error('File request timed out (30s)'));
      }, 30_000);

      pendingFileRequests.set(requestId, {
        resolve: (result) => {
          if ('error' in result) {
            reject(new Error(result.error));
          } else {
            resolve(result.data);
          }
        },
        timeout,
        label,
      });

      const msg = JSON.stringify({ type: 'file-request', path: filePath, requestId });
      session.agentSocket.send(msg);
    });
  };

  /**
   * Send a file upload to an agent and wait for the response.
   * The agent must have an active session (WebSocket connected).
   */
  const sendFileUpload: SendFileUploadFn = async (
    label: string,
    filePath: string,
    data: string,
    requestId: string,
  ): Promise<true> => {
    const session = activeSessions.get(label);
    if (!session) {
      throw new Error('No active session for this agent');
    }

    if (session.agentSocket.readyState !== 1) {
      throw new Error('Agent WebSocket is not open');
    }

    return new Promise<true>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingFileRequests.delete(requestId);
        reject(new Error('File upload timed out (30s)'));
      }, 30_000);

      pendingFileRequests.set(requestId, {
        resolve: (result) => {
          if ('error' in result) {
            reject(new Error(result.error));
          } else {
            resolve(true);
          }
        },
        timeout,
        label,
      });

      const msg = JSON.stringify({ type: 'file-upload', path: filePath, data, requestId });
      session.agentSocket.send(msg);
    });
  };

  // Decorate the fastify instance so routes can access relay functions
  fastify.decorate('terminateSession', terminateSession);
  fastify.decorate('hasActiveSession', hasActiveSession);
  fastify.decorate('findSessionId', findSessionId);
  fastify.decorate('sendFileRequest', sendFileRequest);
  fastify.decorate('sendFileUpload', sendFileUpload);

  // --- WebSocket routes ---

  // GET /connect/:label — admin connects to start a shell relay
  fastify.get(
    '/connect/:label',
    { websocket: true, preHandler: requireRole(['admin']) },
    async (socket: WebSocket, request: FastifyRequest) => {
      let label: string;
      try {
        ({ label } = AgentLabelParamSchema.parse(request.params));
      } catch {
        socket.close(1008, 'Invalid agent label');
        return;
      }

      // Run the 5-gate auth chain
      const authResult = await runAdminAuthGates(request, label);
      if (!authResult.ok) {
        request.log.warn({ label, error: authResult.error }, 'Shell relay auth failed');
        socket.send(JSON.stringify({ type: 'error', message: authResult.error }));
        socket.close(authResult.code, authResult.error);
        return;
      }

      // Reject if there is already a pending or active session for this label
      if (pendingAdminConnections.has(label) || activeSessions.has(label)) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'A shell session for this agent is already active',
          }),
        );
        socket.close(4409, 'Session already active');
        return;
      }

      // Create audit log entry
      const sourceIp = extractSourceIp(request);
      let sessionEntry: ShellSessionEntry;
      try {
        sessionEntry = await logShellSession(ctx.stateDir, {
          agentLabel: label,
          sourceIp,
          status: 'pending',
        });
      } catch (err) {
        request.log.error({ err, label }, 'Failed to create session audit entry');
        socket.send(
          JSON.stringify({ type: 'error', message: 'Failed to create session audit entry' }),
        );
        socket.close(1011, 'Internal error');
        return;
      }

      // In tunnel mode: request a ticket from the panel targeting this agent
      let panelTicketId: string | undefined;
      if (ticketManager?.isReady() && panelTicketMap) {
        try {
          const ticketId = await ticketManager.requestTicketForAgent(label, true);
          if (ticketId) {
            panelTicketId = ticketId;
            panelTicketMap.store(ticketId, label);
            request.log.info({ label, ticketId: ticketId.slice(0, 8) + '...' }, 'Requested panel ticket for agent');
          } else {
            request.log.error({ label }, 'Ticket manager returned null — ticket not issued');
            socket.send(
              JSON.stringify({ type: 'error', message: 'Failed to request panel ticket' }),
            );
            socket.close(1011, 'Internal error');
            return;
          }
        } catch (err) {
          request.log.error({ err, label }, 'Failed to request panel ticket');
          socket.send(
            JSON.stringify({ type: 'error', message: 'Failed to request panel ticket' }),
          );
          socket.close(1011, 'Internal error');
          return;
        }
      }

      request.log.info({ label, sessionId: sessionEntry.id }, 'Admin connected for shell relay');

      // Check if agent is already connected and waiting
      if (connectedAgents.has(label)) {
        const agentSocket = connectedAgents.get(label)!;
        connectedAgents.delete(label);
        request.log.info({ label }, 'Pairing admin with already-connected agent');
        await pairSockets(label, socket, agentSocket, sessionEntry, request.log);
        return;
      }

      // Agent not connected yet — store pending and wait
      socket.send(JSON.stringify({ type: 'waiting', message: 'Waiting for agent...' }));

      const timeout = setTimeout(() => {
        if (pendingAdminConnections.has(label)) {
          pendingAdminConnections.delete(label);
          request.log.warn({ label }, 'Shell relay timed out waiting for agent');
          try {
            socket.send(
              JSON.stringify({
                type: 'error',
                message: 'Agent did not connect within 30 seconds',
              }),
            );
            socket.close(4408, 'Agent connection timeout');
          } catch {
            /* socket may already be closed */
          }
        }
      }, 30_000);

      pendingAdminConnections.set(label, { socket, request, sessionEntry, timeout, panelTicketId });

      // Clean up if admin disconnects while waiting
      socket.on('close', () => {
        const pending = pendingAdminConnections.get(label);
        if (pending && pending.socket === socket) {
          clearTimeout(pending.timeout);
          pendingAdminConnections.delete(label);
          request.log.info({ label }, 'Admin disconnected while waiting for agent');
        }
      });

      socket.on('error', (err) => {
        request.log.error({ err, label }, 'Admin WebSocket error while waiting');
        const pending = pendingAdminConnections.get(label);
        if (pending && pending.socket === socket) {
          clearTimeout(pending.timeout);
          pendingAdminConnections.delete(label);
        }
      });
    },
  );

  // GET /agent/:label — agent connects to provide shell access (standalone mTLS)
  fastify.get(
    '/agent/:label',
    { websocket: true, preHandler: requireRole(['agent']) },
    async (socket: WebSocket, request: FastifyRequest) => {
      let label: string;
      try {
        ({ label } = AgentLabelParamSchema.parse(request.params));
      } catch {
        socket.close(1008, 'Invalid agent label');
        return;
      }

      // Gate: Global shell must be enabled
      const config = await readShellConfig(ctx.stateDir);
      if (!config.enabled) {
        socket.send(
          JSON.stringify({ type: 'error', message: 'Remote shell is not enabled globally' }),
        );
        socket.close(4400, 'Shell not enabled');
        return;
      }

      // Verify the connecting agent cert matches the requested label
      const auth = getAuth(request);
      if (auth.role === 'agent' && auth.label !== label) {
        request.log.warn(
          { label, certLabel: auth.label },
          'Agent cert label mismatch for shell relay',
        );
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'Agent certificate does not match the requested label',
          }),
        );
        socket.close(4403, 'Agent label mismatch');
        return;
      }

      // Verify agent shell access is still valid
      const agent = await ctx.registry.findNonRevokedAgent(label);
      if (!agent) {
        socket.send(JSON.stringify({ type: 'error', message: `Agent "${label}" not found` }));
        socket.close(4404, 'Agent not found');
        return;
      }

      if (!isAgentShellEnabled(agent)) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'Shell access is not enabled for this agent',
          }),
        );
        socket.close(4403, 'Shell access not enabled');
        return;
      }

      // Reject if agent is already connected for this label
      if (connectedAgents.has(label) || activeSessions.has(label)) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'An agent connection for this label already exists',
          }),
        );
        socket.close(4409, 'Agent already connected');
        return;
      }

      request.log.info({ label }, 'Agent connected for shell relay');

      // Check if an admin is already waiting
      if (pendingAdminConnections.has(label)) {
        const pending = pendingAdminConnections.get(label)!;
        pendingAdminConnections.delete(label);
        clearTimeout(pending.timeout);

        request.log.info({ label }, 'Pairing agent with waiting admin');
        await pairSockets(label, pending.socket, socket, pending.sessionEntry, request.log);
        return;
      }

      // No admin waiting — store agent and wait
      connectedAgents.set(label, socket);
      socket.send(JSON.stringify({ type: 'waiting', message: 'Waiting for admin to connect...' }));

      socket.on('close', () => {
        if (connectedAgents.get(label) === socket) {
          connectedAgents.delete(label);
          request.log.info({ label }, 'Agent disconnected before pairing');
        }
      });

      socket.on('error', (err) => {
        request.log.error({ err, label }, 'Agent WebSocket error while waiting');
        if (connectedAgents.get(label) === socket) {
          connectedAgents.delete(label);
        }
      });
    },
  );

  // GET /agent-ticket/:label — agent connects via ticket-based auth (tunnel mode)
  // Only registered when a ticketStore or panelTicketMap is available (tunnel mode active)
  if (ticketStore || panelTicketMap) fastify.get(
    '/agent-ticket/:label',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      let label: string;
      try {
        ({ label } = AgentLabelParamSchema.parse(request.params));
      } catch {
        socket.close(1008, 'Invalid agent label');
        return;
      }

      // Track the issued session token so it can be revoked on disconnect
      let issuedSessionToken: string | undefined;

      // Wait for the first message to be a ticket
      const ticketTimeout = setTimeout(() => {
        request.log.warn({ label }, 'Ticket handshake timeout');
        socket.close(4408, 'Ticket handshake timeout');
      }, 5_000);

      // Clean up ticket timeout if socket closes early
      socket.on('close', () => {
        clearTimeout(ticketTimeout);
        // Revoke session token when agent-ticket socket disconnects
        if (issuedSessionToken && sessionStore) {
          sessionStore.revoke(issuedSessionToken);
        }
        if (connectedAgents.get(label) === socket) {
          connectedAgents.delete(label);
          request.log.info({ label }, 'Ticket-auth agent disconnected before pairing');
        }
      });

      socket.once('message', async (raw: RawData) => {
        try {
          clearTimeout(ticketTimeout);

          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          } catch {
            socket.close(4401, 'Invalid ticket message');
            return;
          }

          if (msg['type'] !== 'ticket' || typeof msg['ticketId'] !== 'string') {
            socket.close(4401, 'Expected ticket message with ticketId');
            return;
          }

          const ticketId = msg['ticketId'];

          // Validate ticket
          let ticketLabel: string | null = null;

          if (panelTicketMap) {
            // Tunnel mode: consume from panel ticket map
            ticketLabel = panelTicketMap.consume(ticketId);
          } else if (ticketStore) {
            // Standalone mode: validate locally
            const result = ticketStore.consume(ticketId);
            ticketLabel = result?.label ?? null;
          }

          if (!ticketLabel) {
            socket.send(JSON.stringify({ type: 'error', message: 'Invalid or expired ticket' }));
            socket.close(4401, 'Invalid ticket');
            return;
          }

          // Verify ticket label matches route label
          if (ticketLabel !== label) {
            socket.send(
              JSON.stringify({ type: 'error', message: 'Ticket label does not match route' }),
            );
            socket.close(4403, 'Label mismatch');
            return;
          }

          // Resolve command blocklist for this agent
          const config = await readShellConfig(ctx.stateDir);
          const agent = await ctx.registry.findNonRevokedAgent(label);

          // Validation gates — checked BEFORE issuing a session token
          if (!config.enabled) {
            socket.send(
              JSON.stringify({ type: 'error', message: 'Remote shell is not enabled globally' }),
            );
            socket.close(4400, 'Shell not enabled');
            return;
          }

          if (!agent) {
            socket.send(JSON.stringify({ type: 'error', message: `Agent "${label}" not found` }));
            socket.close(4404, 'Agent not found');
            return;
          }

          if (!isAgentShellEnabled(agent)) {
            socket.send(
              JSON.stringify({ type: 'error', message: 'Shell access is not enabled for this agent' }),
            );
            socket.close(4403, 'Shell access not enabled');
            return;
          }

          // Reject if agent is already connected for this label — checked BEFORE issuing session token
          if (connectedAgents.has(label) || activeSessions.has(label)) {
            socket.send(
              JSON.stringify({
                type: 'error',
                message: 'An agent connection for this label already exists',
              }),
            );
            socket.close(4409, 'Agent already connected');
            return;
          }

          // Resolve command blocklist from the agent's assigned policy
          let commandBlocklist: { hardBlocked: string[]; restricted: Record<string, boolean> } | undefined;
          const policyId = agent.shellPolicy ?? config.defaultPolicy;
          const policy = config.policies.find((p) => p.id === policyId);
          if (policy?.commandBlocklist) {
            commandBlocklist = policy.commandBlocklist;
          }

          // Issue session token AFTER all validation gates AND duplicate-session check pass
          let sessionToken: string | undefined;
          if (sessionStore) {
            const session = sessionStore.issue(ticketLabel, {});
            sessionToken = session.sessionToken;
            issuedSessionToken = sessionToken;
          }

          socket.send(JSON.stringify({ type: 'ticket-accepted', sessionToken, commandBlocklist }));

          // Set auth on request for downstream use
          request.shellAuth = { role: 'agent', label: ticketLabel };

          request.log.info({ label }, 'Agent connected via ticket for shell relay');

          // Check if an admin is already waiting
          if (pendingAdminConnections.has(label)) {
            const pending = pendingAdminConnections.get(label)!;
            pendingAdminConnections.delete(label);
            clearTimeout(pending.timeout);
            request.log.info({ label }, 'Pairing ticket-auth agent with waiting admin');
            await pairSockets(label, pending.socket, socket, pending.sessionEntry, request.log);
            return;
          }

          // No admin waiting — store agent and wait
          connectedAgents.set(label, socket);
          socket.send(
            JSON.stringify({ type: 'waiting', message: 'Waiting for admin to connect...' }),
          );

          socket.on('error', (err) => {
            request.log.error({ err, label }, 'Ticket-auth agent WebSocket error while waiting');
            if (connectedAgents.get(label) === socket) {
              connectedAgents.delete(label);
            }
          });
        } catch (err) {
          request.log.error({ err, label }, 'Unhandled error in agent-ticket message handler');
          try {
            socket.close(1011, 'Internal error');
          } catch {
            /* socket may already be closed */
          }
        }
      });
    },
  );

  // Clean up on server shutdown
  fastify.addHook('onClose', async () => {
    // Clean up pending file requests
    for (const [, pending] of pendingFileRequests) {
      clearTimeout(pending.timeout);
      pending.resolve({ error: 'Server shutting down' });
    }
    pendingFileRequests.clear();

    for (const [, pending] of pendingAdminConnections) {
      clearTimeout(pending.timeout);
      try {
        pending.socket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
    }
    pendingAdminConnections.clear();

    for (const [, agentSocket] of connectedAgents) {
      try {
        agentSocket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
    }
    connectedAgents.clear();

    for (const [, session] of activeSessions) {
      clearInterval(session.timeWindowCheck);
      await closeRecordingStream(session.recording);
      try {
        session.adminSocket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
      try {
        session.agentSocket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
    }
    activeSessions.clear();
  });
}
