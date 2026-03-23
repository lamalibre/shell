import { readFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** CLI config directory: ~/.shell-cli/ */
export const CLI_DIR = path.join(os.homedir(), '.shell-cli');

/** CLI config file: ~/.shell-cli/config.json */
export const CLI_CONFIG_PATH = path.join(CLI_DIR, 'config.json');

export interface CliConfig {
  serverUrl: string;
  apiKeyPath?: string; // defaults to ~/.shell/api-key
  certPath?: string;
  keyPath?: string;
  caPath?: string;
}

/**
 * Load the CLI configuration from ~/.shell-cli/config.json.
 * Returns null if the file does not exist.
 */
export async function loadCliConfig(): Promise<CliConfig | null> {
  if (!existsSync(CLI_CONFIG_PATH)) {
    return null;
  }

  const raw = await readFile(CLI_CONFIG_PATH, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid CLI config: expected an object at ${CLI_CONFIG_PATH}`);
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['serverUrl'] !== 'string' || obj['serverUrl'].length === 0) {
    throw new Error(`Invalid CLI config: missing or empty "serverUrl" at ${CLI_CONFIG_PATH}`);
  }

  return parsed as CliConfig;
}

/**
 * Save the CLI configuration to ~/.shell-cli/config.json.
 * Uses atomic write (temp -> fsync -> rename).
 */
export async function saveCliConfig(config: CliConfig): Promise<void> {
  await mkdir(CLI_DIR, { recursive: true, mode: 0o700 });

  const tmp = CLI_CONFIG_PATH + '.tmp';
  const content = JSON.stringify(config, null, 2) + '\n';
  const { open } = await import('node:fs/promises');
  const fd = await open(tmp, 'w', 0o600);
  try {
    await fd.writeFile(content, 'utf-8');
    await fd.datasync();
  } finally {
    await fd.close();
  }
  await rename(tmp, CLI_CONFIG_PATH);
}

/**
 * Load the CLI configuration, exiting with an error if not found.
 */
export async function requireCliConfig(): Promise<CliConfig> {
  const config = await loadCliConfig();
  if (!config) {
    const relPath = path.relative(process.cwd(), CLI_CONFIG_PATH);
    throw new Error(
      `CLI not configured. Create a config file first.\n` +
        `  Expected config at: ${relPath}\n\n` +
        `  Example:\n` +
        `  {\n` +
        `    "serverUrl": "https://localhost:9494",\n` +
        `    "apiKeyPath": "~/.shell/api-key"\n` +
        `  }`,
    );
  }
  return config;
}
