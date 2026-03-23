import pc from 'picocolors';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';
import type { ShellSessionEntry } from '../lib/types.js';
import { formatDate, formatDuration } from '../lib/format.js';

/**
 * Display active and recent shell sessions.
 */
export async function runSessionsCommand(config: CliConfig): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');
  console.log(pc.bold('  Shell Sessions'));
  console.log(pc.dim('  ' + '\u2500'.repeat(28)));

  let sessions: ShellSessionEntry[];
  try {
    const data = await client.get<{ sessions: ShellSessionEntry[] }>('/api/shell/sessions');
    sessions = data.sessions;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${pc.yellow(`Could not fetch sessions: ${message}`)}`);
    console.log('');
    return;
  }

  if (sessions.length === 0) {
    console.log(`  ${pc.dim('No sessions found.')}`);
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
    console.log(`    Source:   ${session.sourceIp || pc.dim('unknown')}`);
    console.log(`    Started:  ${formatDate(session.startedAt)}`);
    if (session.endedAt) {
      console.log(`    Ended:    ${formatDate(session.endedAt)}`);
    }
    console.log(`    Duration: ${formatDuration(session.duration)}`);
    console.log('');
  }
}
