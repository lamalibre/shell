import path from 'node:path';
import pc from 'picocolors';
import type { AgentConfig, ShellSessionEntry } from './types.js';
import { buildConnectionConfig } from './lib/tls.js';
import { fetchSessions, downloadRecording } from './lib/api.js';

/**
 * Parse simple CLI flags from an array of arguments.
 */
function parseFlags(args: string[]): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/**
 * Format a date string for display.
 */
function formatDate(isoDate: string | undefined): string {
  try {
    if (!isoDate) return 'unknown';
    const d = new Date(isoDate);
    return d.toLocaleString();
  } catch {
    return isoDate ?? 'unknown';
  }
}

/**
 * Format duration in seconds to human-readable.
 */
function formatDuration(seconds: number | undefined): string {
  if (seconds == null) return 'unknown';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

/**
 * List shell sessions, optionally filtered by agent label.
 */
async function runList(
  httpsUrl: string,
  tls: { cert: Buffer; key: Buffer; ca?: Buffer; rejectUnauthorized: boolean },
  agentLabel?: string,
): Promise<void> {
  console.log('');
  console.log(pc.bold('  Shell Sessions'));
  console.log(pc.dim('  ' + '\u2500'.repeat(28)));

  let sessions: ShellSessionEntry[];
  try {
    const data = await fetchSessions(httpsUrl, tls);
    sessions = data.sessions;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${pc.yellow(`Could not fetch sessions: ${message}`)}`);
    console.log('');
    return;
  }

  // Filter by agent label if specified
  if (agentLabel) {
    sessions = sessions.filter((s) => s.agentLabel === agentLabel);
  }

  if (sessions.length === 0) {
    const suffix = agentLabel ? ` for agent ${pc.bold(agentLabel)}` : '';
    console.log(`  ${pc.dim(`No sessions found${suffix}.`)}`);
    console.log('');
    return;
  }

  // Sort by start time, newest first
  sessions.sort((a, b) => {
    const da = new Date(a.startedAt).getTime();
    const db = new Date(b.startedAt).getTime();
    return db - da;
  });

  for (const session of sessions) {
    const statusLabel =
      session.status === 'active'
        ? pc.green('Active')
        : session.status === 'ended'
          ? pc.dim('Ended')
          : pc.dim(session.status);

    console.log(`  ${pc.cyan('\u2022')} ${pc.bold(session.id)}`);
    console.log(`    Agent:    ${session.agentLabel || pc.dim('unknown')}`);
    console.log(`    Status:   ${statusLabel}`);
    console.log(`    Started:  ${formatDate(session.startedAt)}`);
    if (session.endedAt) {
      console.log(`    Ended:    ${formatDate(session.endedAt)}`);
    }
    if (session.duration != null) {
      console.log(`    Duration: ${formatDuration(session.duration)}`);
    }
    if (session.commandCount != null) {
      console.log(`    Commands: ${session.commandCount}`);
    }
    console.log('');
  }
}

/**
 * Download a session recording.
 */
async function runDownload(
  httpsUrl: string,
  tls: { cert: Buffer; key: Buffer; ca?: Buffer; rejectUnauthorized: boolean },
  agentLabel: string,
  sessionId: string,
): Promise<void> {
  const outputPath = path.resolve(`${sessionId}.log`);

  console.log('');
  console.log(pc.dim(`  Downloading recording for session ${pc.bold(sessionId)}...`));

  try {
    await downloadRecording(httpsUrl, tls, agentLabel, sessionId, outputPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`\n  Download failed: ${message}\n`));
    process.exit(1);
  }

  console.log(`  Recording saved to ${pc.cyan(outputPath)}`);
  console.log('');
}

/**
 * Shell log command: list or download session recordings.
 */
export async function runLog(args: string[], config: AgentConfig): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const agentLabel = positional[0];

  // Build a connection config just for HTTPS calls (no WS path needed)
  let conn;
  try {
    conn = await buildConnectionConfig(config, '/unused');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`\n  Failed to load credentials: ${message}\n`));
    process.exit(1);
  }

  if (flags['download']) {
    const sessionId = typeof flags['download'] === 'string' ? flags['download'] : null;
    if (!sessionId || !agentLabel) {
      console.error(
        `\n  Usage: ${pc.cyan('shell-agent log <agent-label> --download <session-id>')}\n`,
      );
      process.exit(1);
    }
    await runDownload(conn.httpsUrl, conn.tls, agentLabel, sessionId);
    if (conn.cleanup) await conn.cleanup();
    return;
  }

  // Default to list behavior
  await runList(conn.httpsUrl, conn.tls, agentLabel);
  if (conn.cleanup) await conn.cleanup();
}
