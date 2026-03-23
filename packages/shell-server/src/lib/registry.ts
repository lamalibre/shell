import { readFile } from 'node:fs/promises';
import type { ShellAgent, AgentRegistry } from '../types.js';
import { atomicWriteJson } from './file-utils.js';
import path from 'node:path';

// --- Promise-chain mutex ---

function createLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = chain;
    let resolve: () => void;
    chain = new Promise<void>((r) => {
      resolve = r;
    });
    return prev.then(fn).finally(() => resolve());
  };
}

// --- Standalone agent registry ---

interface AgentFile {
  agents: ShellAgent[];
}

export class StandaloneAgentRegistry implements AgentRegistry {
  private readonly filePath: string;
  private readonly withLock: <T>(fn: () => Promise<T>) => Promise<T>;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, 'agents.json');
    this.withLock = createLock();
  }

  private async load(): Promise<AgentFile> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as AgentFile;
      return { agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { agents: [] };
      }
      throw err;
    }
  }

  private async save(data: AgentFile): Promise<void> {
    await atomicWriteJson(this.filePath, data);
  }

  async findNonRevokedAgent(label: string): Promise<ShellAgent | undefined> {
    const data = await this.load();
    return data.agents.find((a) => a.label === label && !a.revoked);
  }

  async updateAgent(label: string, update: (agent: ShellAgent) => void): Promise<void> {
    await this.withLock(async () => {
      const data = await this.load();
      const agent = data.agents.find((a) => a.label === label && !a.revoked);
      if (!agent) {
        throw new Error(`Agent "${label}" not found`);
      }
      update(agent);
      await this.save(data);
    });
  }

  async listAgents(): Promise<readonly ShellAgent[]> {
    const data = await this.load();
    return data.agents;
  }

  /** Add an agent to the registry. Used during enrollment in standalone mode. */
  async addAgent(agent: ShellAgent): Promise<void> {
    await this.withLock(async () => {
      const data = await this.load();
      data.agents.push(agent);
      await this.save(data);
    });
  }
}

// --- Delegating registry for plugin mode ---

export interface PortlamaAgent {
  label: string;
  revoked: boolean;
  shellEnabledUntil?: string;
  shellPolicy?: string;
  [key: string]: unknown;
}

interface PortlamaRegistryData {
  agents: PortlamaAgent[];
}

export class DelegatingAgentRegistry implements AgentRegistry {
  constructor(
    private readonly loadFn: () => Promise<PortlamaRegistryData>,
    private readonly saveFn: (data: PortlamaRegistryData) => Promise<void>,
  ) {}

  private toShellAgent(agent: PortlamaAgent): ShellAgent {
    return {
      label: agent.label,
      revoked: agent.revoked,
      ...(agent.shellEnabledUntil !== undefined
        ? { shellEnabledUntil: agent.shellEnabledUntil }
        : {}),
      ...(agent.shellPolicy !== undefined ? { shellPolicy: agent.shellPolicy } : {}),
    };
  }

  async findNonRevokedAgent(label: string): Promise<ShellAgent | undefined> {
    const data = await this.loadFn();
    const agent = data.agents.find((a) => a.label === label && !a.revoked);
    return agent ? this.toShellAgent(agent) : undefined;
  }

  async updateAgent(label: string, update: (agent: ShellAgent) => void): Promise<void> {
    const data = await this.loadFn();
    const agent = data.agents.find((a) => a.label === label && !a.revoked);
    if (!agent) {
      throw new Error(`Agent "${label}" not found`);
    }
    // Create a ShellAgent view, apply the update, then copy shell fields back
    const view = this.toShellAgent(agent);
    update(view);
    // Sync shell fields back to the Portlama agent
    if ('shellEnabledUntil' in view) {
      agent.shellEnabledUntil = view.shellEnabledUntil;
    } else {
      delete agent.shellEnabledUntil;
    }
    if ('shellPolicy' in view) {
      agent.shellPolicy = view.shellPolicy;
    } else {
      delete agent.shellPolicy;
    }
    await this.saveFn(data);
  }

  async listAgents(): Promise<readonly ShellAgent[]> {
    const data = await this.loadFn();
    return data.agents.map((a) => this.toShellAgent(a));
  }
}
