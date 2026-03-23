import type { FastifyBaseLogger } from 'fastify';

// --- Policy types ---

export interface CommandBlocklist {
  hardBlocked: string[];
  restricted: Record<string, boolean>;
}

export interface ShellPolicy {
  id: string;
  name: string;
  description: string;
  allowedIps: string[];
  deniedIps: string[];
  maxFileSize: number;
  inactivityTimeout: number;
  commandBlocklist: CommandBlocklist;
}

export interface ShellConfig {
  enabled: boolean;
  policies: ShellPolicy[];
  defaultPolicy: string;
}

// --- Session types ---

export interface ShellSessionEntry {
  id: string;
  agentLabel: string;
  sourceIp: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
}

// --- Agent types ---

export interface ShellAgent {
  label: string;
  revoked: boolean;
  shellEnabledUntil?: string;
  shellPolicy?: string;
}

// --- Auth types ---

export interface AuthInfo {
  role: 'admin' | 'agent';
  label: string | null;
}

// --- Registry interface ---

export interface AgentRegistry {
  findNonRevokedAgent(label: string): Promise<ShellAgent | undefined>;
  updateAgent(label: string, update: (agent: ShellAgent) => void): Promise<void>;
  listAgents(): Promise<readonly ShellAgent[]>;
}

// --- Context ---

export interface ShellContext {
  registry: AgentRegistry;
  stateDir: string;
  log: FastifyBaseLogger | null;
}

// --- Validation result ---

export type ShellAccessResult =
  | { ok: true; agent: ShellAgent; config: ShellConfig; policy: ShellPolicy }
  | { ok: false; error: string; statusCode: number };

// --- Route options ---

export interface RouteOpts {
  ctx: ShellContext;
  requireRole: (
    roles: Array<'admin' | 'agent'>,
  ) => (
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ) => Promise<void>;
}

export interface RouteOptsWithAuth extends RouteOpts {
  getAuth: (request: import('fastify').FastifyRequest) => AuthInfo;
  ticketStore?: import('./lib/tunnel-auth.js').TicketStore | undefined;
  sessionStore?: import('./lib/tunnel-auth.js').SessionStore | undefined;
  ticketManager?: import('@lamalibre/portlama-tickets').TicketInstanceManager | undefined;
  panelTicketMap?: import('./lib/tunnel-auth.js').PanelTicketMap | undefined;
}

// --- Relay function types (used by route decorators) ---

export type TerminateSessionFn = (sessionId: string) => Promise<boolean>;
export type HasActiveSessionFn = (label: string) => boolean;
export type FindSessionIdFn = (label: string) => string | undefined;
export type SendFileRequestFn = (label: string, filePath: string, requestId: string) => Promise<string>;
export type SendFileUploadFn = (label: string, filePath: string, data: string, requestId: string) => Promise<true>;

// --- Fastify declaration merging for relay decorators ---

declare module 'fastify' {
  interface FastifyInstance {
    terminateSession: TerminateSessionFn;
    hasActiveSession: HasActiveSessionFn;
    findSessionId: FindSessionIdFn;
    sendFileRequest: SendFileRequestFn;
    sendFileUpload: SendFileUploadFn;
  }
}

// --- Errors ---

export class ShellError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ShellError';
  }
}
