import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  ShellConfig,
  ShellPolicy,
  ShellSessionEntry,
  ShellAgent,
  ShellContext,
  ShellAccessResult,
} from '../types.js';
import { ShellError } from '../types.js';
import { atomicWriteJson } from './file-utils.js';
import { isIpAllowed } from './ip.js';

// --- Promise-chain mutex ---

let shellLock = Promise.resolve();
function withShellLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = shellLock;
  let resolve: () => void;
  shellLock = new Promise<void>((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(() => resolve());
}

// --- Default policy ---

const DEFAULT_POLICY: ShellPolicy = {
  id: 'default',
  name: 'Default',
  description: 'Standard shell access with restricted commands',
  allowedIps: [],
  deniedIps: [],
  maxFileSize: 100 * 1024 * 1024,
  inactivityTimeout: 600,
  commandBlocklist: {
    hardBlocked: [
      'rm -rf /',
      'rm -rf /*',
      'rm -rf ~',
      'rm -rf ~/*',
      'mkfs',
      'dd if=',
      ':(){ :|:& };:',
      'shutdown',
      'reboot',
      'halt',
      'poweroff',
      'chmod -R 777 /',
      '> /dev/sda',
      '> /dev/disk',
      'curl|sh',
      'curl|bash',
      'wget|sh',
      'wget|bash',
    ],
    restricted: {
      sudo: false,
      su: false,
      launchctl: false,
      systemctl: false,
      networksetup: false,
      ifconfig: false,
      diskutil: false,
      iptables: false,
      ufw: false,
    },
  },
};

const DEFAULT_SHELL_CONFIG: ShellConfig = {
  enabled: false,
  policies: [structuredClone(DEFAULT_POLICY)],
  defaultPolicy: 'default',
};

// --- Helpers ---

function shellConfigPath(stateDir: string): string {
  return path.join(stateDir, 'shell-config.json');
}

function shellSessionsPath(stateDir: string): string {
  return path.join(stateDir, 'shell-sessions.json');
}

/**
 * Deep-merge a single policy with the default policy template to ensure
 * all nested fields exist.
 */
function mergePolicyWithDefaults(policy: Partial<ShellPolicy> & { id: string }): ShellPolicy {
  return {
    ...structuredClone(DEFAULT_POLICY),
    ...policy,
    commandBlocklist: {
      ...structuredClone(DEFAULT_POLICY.commandBlocklist),
      ...(policy.commandBlocklist ?? {}),
      restricted: {
        ...structuredClone(DEFAULT_POLICY.commandBlocklist.restricted),
        ...(policy.commandBlocklist?.restricted ?? {}),
      },
    },
  };
}

// --- Shell config ---

/**
 * Read shell configuration from disk.
 * Returns defaults if the file does not exist.
 */
export async function readShellConfig(stateDir: string): Promise<ShellConfig> {
  try {
    const raw = await readFile(shellConfigPath(stateDir), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Handle legacy flat config by migrating to policy-based structure
    if (!Array.isArray(parsed['policies'])) {
      const legacyPolicy: ShellPolicy = {
        id: 'default',
        name: 'Default',
        description: 'Standard shell access with restricted commands',
        allowedIps: (parsed['allowedIps'] as string[]) ?? [],
        deniedIps: (parsed['deniedIps'] as string[]) ?? [],
        maxFileSize: (parsed['maxFileSize'] as number | undefined) ?? DEFAULT_POLICY.maxFileSize,
        inactivityTimeout:
          (parsed['inactivityTimeout'] as number | undefined) ?? DEFAULT_POLICY.inactivityTimeout,
        commandBlocklist: {
          ...DEFAULT_POLICY.commandBlocklist,
          ...((parsed['commandBlocklist'] as Record<string, unknown>) ?? {}),
          restricted: {
            ...DEFAULT_POLICY.commandBlocklist.restricted,
            ...(((parsed['commandBlocklist'] as Record<string, unknown>)?.['restricted'] as Record<
              string,
              boolean
            >) ?? {}),
          },
        },
      };
      return {
        enabled: (parsed['enabled'] as boolean) ?? false,
        policies: [legacyPolicy],
        defaultPolicy: 'default',
      };
    }

    const policies = (parsed['policies'] as Array<Partial<ShellPolicy> & { id: string }>).map((p) =>
      mergePolicyWithDefaults(p),
    );

    return {
      enabled: (parsed['enabled'] as boolean) ?? false,
      policies,
      defaultPolicy: (parsed['defaultPolicy'] as string) ?? 'default',
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(DEFAULT_SHELL_CONFIG);
    }
    throw new Error(`Failed to read shell config: ${(err as Error).message}`);
  }
}

/**
 * Write shell configuration to disk atomically.
 */
export async function writeShellConfig(stateDir: string, config: ShellConfig): Promise<void> {
  await atomicWriteJson(shellConfigPath(stateDir), config);
}

// --- Shell sessions audit log ---

/**
 * Read the shell sessions audit log.
 */
export async function readShellSessions(stateDir: string): Promise<ShellSessionEntry[]> {
  try {
    const raw = await readFile(shellSessionsPath(stateDir), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ShellSessionEntry[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read shell sessions: ${(err as Error).message}`);
  }
}

/**
 * Write the shell sessions audit log atomically.
 */
export async function writeShellSessions(
  stateDir: string,
  sessions: ShellSessionEntry[],
): Promise<void> {
  await atomicWriteJson(shellSessionsPath(stateDir), sessions);
}

/**
 * Add a session entry to the audit log.
 * Wrapped in withShellLock to prevent concurrent read-modify-write races.
 */
export function logShellSession(
  stateDir: string,
  entry: Omit<ShellSessionEntry, 'id' | 'startedAt'>,
): Promise<ShellSessionEntry> {
  return withShellLock(async () => {
    const sessions = await readShellSessions(stateDir);
    const newEntry: ShellSessionEntry = {
      id: randomUUID(),
      ...entry,
      startedAt: new Date().toISOString(),
    };
    sessions.push(newEntry);
    // Keep last 500 entries
    if (sessions.length > 500) {
      sessions.splice(0, sessions.length - 500);
    }
    await writeShellSessions(stateDir, sessions);
    return newEntry;
  });
}

/**
 * Update an existing session entry in the audit log by ID.
 * Wrapped in withShellLock to prevent concurrent read-modify-write races.
 */
export function updateShellSession(
  stateDir: string,
  sessionId: string,
  updates: Partial<ShellSessionEntry>,
): Promise<ShellSessionEntry | null> {
  return withShellLock(async () => {
    const sessions = await readShellSessions(stateDir);
    const entry = sessions.find((s) => s.id === sessionId);
    if (!entry) return null;
    Object.assign(entry, updates);
    await writeShellSessions(stateDir, sessions);
    return entry;
  });
}

// --- Agent shell access management ---

/**
 * Enable shell access for an agent.
 * Sets shellEnabledUntil and shellPolicy on the agent registry entry.
 */
export async function enableAgentShell(
  ctx: ShellContext,
  label: string,
  durationMinutes: number,
  policyId?: string,
): Promise<{ ok: true; label: string; shellEnabledUntil: string; shellPolicy: string }> {
  return withShellLock(async () => {
    const config = await readShellConfig(ctx.stateDir);

    const resolvedPolicyId = policyId ?? config.defaultPolicy;
    const policy = config.policies.find((p) => p.id === resolvedPolicyId);
    if (!policy) {
      throw new ShellError(`Policy "${resolvedPolicyId}" not found`, 404);
    }

    const agent = await ctx.registry.findNonRevokedAgent(label);
    if (!agent) {
      throw new ShellError(`Agent certificate "${label}" not found`, 404);
    }

    const until = new Date(Date.now() + durationMinutes * 60 * 1000);
    const shellEnabledUntil = until.toISOString();

    await ctx.registry.updateAgent(label, (a) => {
      a.shellEnabledUntil = shellEnabledUntil;
      a.shellPolicy = resolvedPolicyId;
    });

    return {
      ok: true as const,
      label,
      shellEnabledUntil,
      shellPolicy: resolvedPolicyId,
    };
  });
}

/**
 * Disable shell access for an agent.
 * Removes shellEnabledUntil and shellPolicy from the agent registry entry.
 */
export async function disableAgentShell(
  ctx: ShellContext,
  label: string,
): Promise<{ ok: true; label: string }> {
  return withShellLock(async () => {
    const agent = await ctx.registry.findNonRevokedAgent(label);
    if (!agent) {
      throw new ShellError(`Agent certificate "${label}" not found`, 404);
    }

    await ctx.registry.updateAgent(label, (a) => {
      delete a.shellEnabledUntil;
      delete a.shellPolicy;
    });

    return { ok: true as const, label };
  });
}

/**
 * Check if shell access is currently allowed for an agent.
 * Returns true only if shellEnabledUntil is set and in the future.
 */
export function isAgentShellEnabled(agent: ShellAgent | undefined): boolean {
  if (!agent || agent.revoked) return false;
  if (!agent.shellEnabledUntil) return false;
  return new Date(agent.shellEnabledUntil) > new Date();
}

// --- Reusable shell access validation ---

/**
 * Run the 5-gate auth check for shell access to an agent.
 *
 * Gate 1 = admin role (enforced by route preHandler, not checked here)
 * Gate 2 = global enabled
 * Gate 3 = agent cert valid (exists and not revoked)
 * Gate 4 = time window (shellEnabledUntil is in the future)
 * Gate 5 = IP ACL (source IP passes the policy's allow/deny lists)
 */
export async function validateShellAccess(
  ctx: ShellContext,
  label: string,
  sourceIp: string,
): Promise<ShellAccessResult> {
  // Gate 2: Global shell enabled
  const config = await readShellConfig(ctx.stateDir);
  if (!config.enabled) {
    return { ok: false, error: 'Remote shell is not enabled globally', statusCode: 400 };
  }

  // Gate 3: Agent cert exists and is not revoked
  const agent = await ctx.registry.findNonRevokedAgent(label);
  if (!agent) {
    return { ok: false, error: `Agent certificate "${label}" not found`, statusCode: 404 };
  }

  // Gate 4: Agent shellEnabledUntil is in the future
  if (!isAgentShellEnabled(agent)) {
    return {
      ok: false,
      error: `Shell access not enabled for agent "${label}"`,
      statusCode: 403,
    };
  }

  // Resolve the agent's assigned policy
  const policyId = agent.shellPolicy ?? config.defaultPolicy;
  const policy = config.policies.find((p) => p.id === policyId);
  if (!policy) {
    return {
      ok: false,
      error: `Policy "${policyId}" not found in shell configuration`,
      statusCode: 500,
    };
  }

  // Gate 5: Source IP passes the policy's allow/deny lists
  if (!isIpAllowed(sourceIp, policy.allowedIps, policy.deniedIps)) {
    return { ok: false, error: 'Source IP is not allowed', statusCode: 403 };
  }

  return { ok: true, agent, config, policy };
}
