import { readFile, rename, mkdir, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { AGENT_DIR, RECORDINGS_DIR, BLOCKLIST_PATH, SHELL_WRAPPER_PATH } from './lib/platform.js';
import type { CommandBlocklist, ShellBlocklist } from './types.js';

const TMUX_SESSION_NAME = 'shell-agent';

/** Strict allowlist of permitted tmux special key names. */
export const ALLOWED_SPECIAL_KEYS = new Set([
  'Enter',
  'Escape',
  'C-c',
  'C-d',
  'C-z',
  'Tab',
  'Up',
  'Down',
  'Left',
  'Right',
  'BSpace',
  'DC',
  'Home',
  'End',
  'PPage',
  'NPage',
]);

/**
 * Install the shell wrapper script to ~/.shell-agent/.
 * Copies from the bundled template in src/lib/.
 */
export async function installShellWrapper(): Promise<void> {
  const srcPath = new URL('./lib/shell-wrapper.sh', import.meta.url).pathname;
  if (!existsSync(srcPath)) {
    throw new Error(`Shell wrapper template not found at ${srcPath}`);
  }
  await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });
  const content = await readFile(srcPath, 'utf8');
  const tmp = SHELL_WRAPPER_PATH + '.tmp';
  const fh = await open(tmp, 'w', 0o755);
  try {
    await fh.writeFile(content, 'utf8');
    await fh.datasync();
  } finally {
    await fh.close();
  }
  await rename(tmp, SHELL_WRAPPER_PATH);
}

/**
 * Write the command blocklist file for the shell wrapper.
 * Transforms the server blocklist format into the format shell-wrapper.sh expects.
 */
export async function writeBlocklist(blocklist: CommandBlocklist): Promise<void> {
  await mkdir(AGENT_DIR, { recursive: true });
  const shellBlocklist: ShellBlocklist = {
    hardBlocked: blocklist.hardBlocked,
    blockedPatterns: [], // server doesn't use regex patterns yet
    restrictedPrefixes: Object.entries(blocklist.restricted)
      .filter(([, allowed]) => !allowed)
      .map(([cmd]) => cmd),
  };
  const tmp = BLOCKLIST_PATH + '.tmp';
  const fh = await open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(JSON.stringify(shellBlocklist, null, 2) + '\n', 'utf8');
    await fh.datasync();
  } finally {
    await fh.close();
  }
  await rename(tmp, BLOCKLIST_PATH);
}

/**
 * Kill any existing shell-agent tmux session.
 */
export async function killTmuxSession(): Promise<void> {
  try {
    await execa('tmux', ['kill-session', '-t', TMUX_SESSION_NAME]);
  } catch {
    // Session may not exist — that is fine
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Spawn a tmux session for the shell gateway.
 * @param sessionId - Unique session identifier for recording (must be a UUID)
 * @returns The session ID
 */
export async function spawnTmuxSession(sessionId: string): Promise<string> {
  if (!UUID_RE.test(sessionId)) {
    throw new Error('Invalid sessionId: must be a UUID');
  }
  await mkdir(RECORDINGS_DIR, { recursive: true });
  await killTmuxSession();

  // Spawn a new detached tmux session with the shell wrapper
  const shellCmd = existsSync(SHELL_WRAPPER_PATH) ? SHELL_WRAPPER_PATH : '/bin/bash';
  await execa('tmux', [
    'new-session',
    '-d',
    '-s',
    TMUX_SESSION_NAME,
    '-x',
    '120',
    '-y',
    '40',
    shellCmd,
  ]);

  // Enable session recording via pipe-pane
  const recordingFile = path.join(RECORDINGS_DIR, `${sessionId}.log`);
  await execa('tmux', [
    'pipe-pane',
    '-t',
    TMUX_SESSION_NAME,
    `cat >> '${recordingFile.replace(/'/g, "'\\''")}'`,
  ]);

  return sessionId;
}

/**
 * Read current tmux pane content.
 * Uses capture-pane to get the visible buffer.
 */
export async function captureTmuxOutput(): Promise<string> {
  try {
    const { stdout } = await execa('tmux', [
      'capture-pane',
      '-t',
      TMUX_SESSION_NAME,
      '-p',
      '-S',
      '-',
    ]);
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Send keystrokes to the tmux session.
 * Uses send-keys with literal flag to send exact characters.
 */
export async function sendToTmux(data: string): Promise<void> {
  await execa('tmux', ['send-keys', '-t', TMUX_SESSION_NAME, '-l', data]);
}

/**
 * Send a special key (like Enter, Ctrl-C) to the tmux session.
 * Only keys in the allowlist are accepted to prevent injection.
 */
export async function sendSpecialKey(key: string): Promise<void> {
  if (!ALLOWED_SPECIAL_KEYS.has(key)) {
    throw new Error(`Rejected special key not in allowlist: ${key}`);
  }
  await execa('tmux', ['send-keys', '-t', TMUX_SESSION_NAME, key]);
}

/**
 * Resize the tmux session window.
 */
export async function resizeTmux(cols: number, rows: number): Promise<void> {
  try {
    await execa('tmux', [
      'resize-window',
      '-t',
      TMUX_SESSION_NAME,
      '-x',
      String(cols),
      '-y',
      String(rows),
    ]);
  } catch {
    // May fail if tmux version doesn't support resize-window
  }
}
