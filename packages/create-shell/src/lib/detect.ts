import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function detectPlatform(): 'darwin' | 'linux' | 'unsupported' {
  const p = process.platform;
  if (p === 'darwin') return 'darwin';
  if (p === 'linux') return 'linux';
  return 'unsupported';
}

export function detectTmux(): boolean {
  try {
    execFileSync('which', ['tmux'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function detectExistingInstall(): boolean {
  return existsSync(join(homedir(), '.shell'));
}

export interface PortlamaConfig {
  panelUrl: string;
  authMethod: 'p12' | 'keychain';
  p12Path?: string;
  p12Password?: string;
  keychainIdentity?: string;
  agentLabel?: string;
  domain: string;
}

/**
 * Detect whether Portlama is installed on this machine by reading
 * ~/.portlama/agent.json. Returns null if not found or invalid.
 */
export function detectPortlama(): PortlamaConfig | null {
  const configPath = join(homedir(), '.portlama', 'agent.json');
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;

    const panelUrl = data['panelUrl'] as string | undefined;
    const domain = data['domain'] as string | undefined;
    const authMethod = data['authMethod'] as string | undefined;

    if (!panelUrl || !domain) return null;
    if (authMethod !== 'p12' && authMethod !== 'keychain') return null;

    return {
      panelUrl,
      domain,
      authMethod,
      p12Path: data['p12Path'] as string | undefined,
      p12Password: data['p12Password'] as string | undefined,
      keychainIdentity: data['keychainIdentity'] as string | undefined,
      agentLabel: data['label'] as string | undefined,
    };
  } catch {
    return null;
  }
}
