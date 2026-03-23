import path from 'node:path';
import os from 'node:os';

/** Agent state directory: ~/.shell-agent/ */
export const AGENT_DIR = path.join(os.homedir(), '.shell-agent');

/** Agent config file: ~/.shell-agent/agent.json */
export const CONFIG_PATH = path.join(AGENT_DIR, 'agent.json');

/** Session recordings directory: ~/.shell-agent/recordings/ */
export const RECORDINGS_DIR = path.join(AGENT_DIR, 'recordings');

/** Command blocklist file: ~/.shell-agent/shell-blocklist.json */
export const BLOCKLIST_PATH = path.join(AGENT_DIR, 'shell-blocklist.json');

/** Shell wrapper script: ~/.shell-agent/shell-wrapper.sh */
export const SHELL_WRAPPER_PATH = path.join(AGENT_DIR, 'shell-wrapper.sh');

/**
 * Assert the current platform is macOS or Linux.
 * Exits with an error message on unsupported platforms.
 */
export function assertSupportedPlatform(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    console.error(
      `Unsupported platform: ${process.platform}. Shell agent requires macOS or Linux.`,
    );
    process.exit(1);
  }
}
