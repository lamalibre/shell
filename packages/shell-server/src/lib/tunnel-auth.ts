import { randomBytes, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

// --- Ticket Store (short-lived, single-use tickets) ---

interface PendingTicket {
  token: string;
  label: string;
  capabilities: Record<string, boolean>;
  createdAt: number;
  expiresAt: number;
}

const TICKET_TTL_MS = 30_000;
const MAX_PENDING_TICKETS = 1000;

export class TicketStore {
  private readonly tickets = new Map<string, PendingTicket>();
  /** Random key used to HMAC ticket tokens before using them as map keys,
   *  so that the timing of Map.get() does not leak information about stored tokens. */
  private readonly hmacKey = randomBytes(32);

  /** Derive a fixed-length HMAC digest to use as the map key. */
  private hash(token: string): string {
    return createHmac('sha256', this.hmacKey).update(token).digest('hex');
  }

  /**
   * Issue a new single-use ticket for an agent.
   */
  issue(label: string, capabilities: Record<string, boolean> = {}): { ticket: string; expiresIn: number } {
    this.pruneExpired();
    this.evictIfFull();

    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    this.tickets.set(this.hash(token), {
      token,
      label,
      capabilities,
      createdAt: now,
      expiresAt: now + TICKET_TTL_MS,
    });

    return { ticket: token, expiresIn: 30 };
  }

  /**
   * Validate and consume a ticket (single-use). Returns agent info or null.
   */
  consume(token: string): { label: string; capabilities: Record<string, boolean> } | null {
    this.pruneExpired();
    const key = this.hash(token);
    const ticket = this.tickets.get(key);
    if (!ticket) return null;
    if (Date.now() > ticket.expiresAt) {
      this.tickets.delete(key);
      return null;
    }
    this.tickets.delete(key);
    return { label: ticket.label, capabilities: ticket.capabilities };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, ticket] of this.tickets) {
      if (now > ticket.expiresAt) {
        this.tickets.delete(key);
      }
    }
  }

  private evictIfFull(): void {
    if (this.tickets.size < MAX_PENDING_TICKETS) return;
    // FIFO eviction — delete oldest entries
    const entries = [...this.tickets.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = entries.slice(0, entries.length - MAX_PENDING_TICKETS + 1);
    for (const [key] of toRemove) {
      this.tickets.delete(key);
    }
  }
}

// --- Session Store (longer-lived session tokens after ticket validation) ---

interface SessionEntry {
  token: string;
  label: string;
  capabilities: Record<string, boolean>;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 3_600_000; // 1 hour
const MAX_SESSIONS = 100;

export class SessionStore {
  private readonly sessions = new Map<string, SessionEntry>();
  /** Random key used to HMAC session tokens before using them as map keys,
   *  so that the timing of Map.get() does not leak information about stored tokens. */
  private readonly hmacKey = randomBytes(32);

  /** Derive a fixed-length HMAC digest to use as the map key. */
  private hashToken(token: string): string {
    return createHmac('sha256', this.hmacKey).update(token).digest('hex');
  }

  /**
   * Issue a session token for a validated agent.
   */
  issue(label: string, capabilities: Record<string, boolean> = {}): { sessionToken: string; expiresIn: number } {
    this.pruneExpired();
    this.evictIfFull();

    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    this.sessions.set(this.hashToken(token), {
      token,
      label,
      capabilities,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });

    return { sessionToken: token, expiresIn: 3600 };
  }

  /**
   * Validate a session token. Returns agent info or null.
   * Uses HMAC-hashed keys so Map lookup timing does not reveal stored tokens.
   */
  validate(token: string): { label: string; capabilities: Record<string, boolean> } | null {
    const key = this.hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(key);
      return null;
    }
    return { label: session.label, capabilities: session.capabilities };
  }

  /**
   * Revoke a session token.
   */
  revoke(token: string): void {
    this.sessions.delete(this.hashToken(token));
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(key);
      }
    }
  }

  private evictIfFull(): void {
    if (this.sessions.size < MAX_SESSIONS) return;
    const entries = [...this.sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = entries.slice(0, entries.length - MAX_SESSIONS + 1);
    for (const [key] of toRemove) {
      this.sessions.delete(key);
    }
  }
}

// --- Panel Ticket Map (maps ticketId -> label for server-requested tickets) ---

const PANEL_TICKET_TTL_MS = 30_000;

interface PanelTicketEntry {
  ticketId: string;
  label: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Single-use map of ticket IDs that this server requested from the panel.
 * When an agent connects with a ticketId, we consume it here to verify
 * the panel flow completed and extract the target label.
 */
export class PanelTicketMap {
  private readonly entries = new Map<string, PanelTicketEntry>();
  /** Random key used to HMAC ticket IDs before using them as map keys,
   *  so that the timing of Map.get() does not leak information about stored IDs. */
  private readonly hmacKey = randomBytes(32);

  /** Derive a fixed-length HMAC digest to use as the map key. */
  private hash(id: string): string {
    return createHmac('sha256', this.hmacKey).update(id).digest('hex');
  }

  /**
   * Store a ticket ID with its associated label.
   */
  store(ticketId: string, label: string): void {
    this.pruneExpired();
    const now = Date.now();
    this.entries.set(this.hash(ticketId), {
      ticketId,
      label,
      createdAt: now,
      expiresAt: now + PANEL_TICKET_TTL_MS,
    });
  }

  /**
   * Consume a ticket ID (single-use). Returns the label or null.
   */
  consume(ticketId: string): string | null {
    this.pruneExpired();
    const key = this.hash(ticketId);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    return entry.label;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
      }
    }
  }
}

// --- Tunnel config ---

export interface TunnelConfig {
  fqdn: string;
  subdomain: string;
  tunnelId: string;
  panelUrl: string;
  portlamaP12Path: string;
  portlamaP12Password: string;
  createdAt: string;
}

const TunnelConfigSchema = z.object({
  fqdn: z.string().min(1),
  subdomain: z.string().min(1),
  tunnelId: z.string().min(1),
  panelUrl: z.string().url(),
  portlamaP12Path: z.string().min(1),
  portlamaP12Password: z.string().min(1),
  createdAt: z.string().min(1),
});

/**
 * Load tunnel config from the state directory.
 * Returns null if tunnel.json does not exist or fails validation.
 */
export async function loadTunnelConfig(stateDir: string): Promise<TunnelConfig | null> {
  const configPath = join(stateDir, 'tunnel.json');
  if (!existsSync(configPath)) return null;

  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = TunnelConfigSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}
