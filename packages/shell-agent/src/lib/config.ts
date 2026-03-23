import { readFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AGENT_DIR, CONFIG_PATH } from './platform.js';
import type { AgentConfig } from '../types.js';

/**
 * Load the agent configuration from ~/.shell-agent/agent.json.
 * Returns null if the file does not exist.
 */
export async function loadAgentConfig(): Promise<AgentConfig | null> {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }

  const raw = await readFile(CONFIG_PATH, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid agent config: expected an object at ${CONFIG_PATH}`);
  }

  const obj = parsed as Record<string, unknown>;

  if (obj['mode'] !== 'standalone' && obj['mode'] !== 'plugin' && obj['mode'] !== 'tunnel') {
    throw new Error(`Invalid agent config: unknown mode "${String(obj['mode'])}"`);
  }

  return parsed as AgentConfig;
}

/**
 * Save the agent configuration to ~/.shell-agent/agent.json.
 * Uses atomic write (temp -> fsync -> rename).
 */
export async function saveAgentConfig(config: AgentConfig): Promise<void> {
  await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });

  const tmp = CONFIG_PATH + '.tmp';
  const content = JSON.stringify(config, null, 2) + '\n';
  const fd = await import('node:fs/promises').then((fs) => fs.open(tmp, 'w', 0o600));
  try {
    await fd.writeFile(content, 'utf-8');
    await fd.datasync();
  } finally {
    await fd.close();
  }
  await rename(tmp, CONFIG_PATH);
}

/**
 * Load the agent configuration, throwing if not found.
 */
export async function requireAgentConfig(): Promise<AgentConfig> {
  const config = await loadAgentConfig();
  if (!config) {
    const relPath = path.relative(process.cwd(), CONFIG_PATH);
    throw new Error(
      `Agent not configured. Run "shell-agent enroll" first.\n` +
        `  Expected config at: ${relPath}`,
    );
  }
  return config;
}
