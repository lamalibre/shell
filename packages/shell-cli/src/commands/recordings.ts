import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';
import type { RecordingSession } from '../lib/types.js';
import { formatDate, formatDuration } from '../lib/format.js';

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
 * List session recordings for an agent, or download a specific recording.
 */
export async function runRecordingsCommand(
  label: string,
  args: string[],
  config: CliConfig,
): Promise<void> {
  const client = await buildApiClient(config);
  const { flags } = parseFlags(args);

  if (flags['download']) {
    const sessionId = typeof flags['download'] === 'string' ? flags['download'] : null;
    if (!sessionId) {
      console.error(
        `\n  Usage: ${pc.cyan('shell recordings <agent-label> --download <session-id>')}\n`,
      );
      process.exit(1);
    }

    console.log('');

    let response: { statusCode: number; body: string };
    try {
      response = await client.getRaw(
        `/api/shell/recordings/${encodeURIComponent(label)}/${encodeURIComponent(sessionId)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`  Failed to download recording: ${message}\n`));
      process.exit(1);
    }

    if (response.statusCode >= 400) {
      console.error(pc.red(`  Server returned HTTP ${response.statusCode}\n`));
      process.exit(1);
    }

    const fileName = `${sessionId}.log`;
    const filePath = path.resolve(process.cwd(), fileName);
    await writeFile(filePath, response.body, 'utf-8');

    const sizeBytes = Buffer.byteLength(response.body, 'utf-8');
    const sizeKb = (sizeBytes / 1024).toFixed(1);

    console.log(pc.green(`  Recording saved.`));
    console.log(`  File:  ${pc.bold(filePath)}`);
    console.log(`  Size:  ${sizeKb} KB`);
    console.log('');
    return;
  }

  // List recordings for the agent
  console.log('');
  console.log(pc.bold(`  Recordings for ${label}`));
  console.log(pc.dim('  ' + '\u2500'.repeat(28)));

  let sessions: RecordingSession[];
  try {
    const data = await client.get<{ recordings: RecordingSession[] }>(
      `/api/shell/recordings/${encodeURIComponent(label)}`,
    );
    sessions = data.recordings;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${pc.yellow(`Could not fetch recordings: ${message}`)}`);
    console.log('');
    return;
  }

  if (sessions.length === 0) {
    console.log(`  ${pc.dim('No recordings found.')}`);
    console.log('');
    return;
  }

  for (const session of sessions) {
    console.log(`  ${pc.cyan('\u2022')} ${pc.bold(session.sessionId)}`);
    console.log(`    Started:  ${formatDate(session.startedAt)}`);
    if (session.endedAt) {
      console.log(`    Ended:    ${formatDate(session.endedAt)}`);
    }
    if (session.duration != null) {
      console.log(`    Duration: ${formatDuration(session.duration)}`);
    }
    console.log('');
  }

  console.log(
    pc.dim(`  Use ${pc.cyan(`shell recordings ${label} --download <session-id>`)} to download.`),
  );
  console.log('');
}
