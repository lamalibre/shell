import pc from 'picocolors';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';
import type { AgentEntry } from '../lib/types.js';
import { formatTimeRemaining } from '../lib/format.js';

/**
 * Display enrolled agents and their status.
 */
export async function runAgentsCommand(config: CliConfig): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');
  console.log(pc.bold('  Enrolled Agents'));
  console.log(pc.dim('  ' + '\u2500'.repeat(28)));

  let agents: AgentEntry[];
  try {
    const data = await client.get<{ agents: AgentEntry[] }>('/api/shell/agents');
    agents = data.agents;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${pc.yellow(`Could not fetch agents: ${message}`)}`);
    console.log('');
    return;
  }

  if (agents.length === 0) {
    console.log(`  ${pc.dim('No agents enrolled.')}`);
    console.log('');
    return;
  }

  // Sort alphabetically by label
  agents.sort((a, b) => a.label.localeCompare(b.label));

  for (const agent of agents) {
    let statusLabel: string;
    if (agent.revoked) {
      statusLabel = pc.red('revoked');
    } else if (agent.shellEnabledUntil) {
      const remaining = formatTimeRemaining(agent.shellEnabledUntil);
      if (remaining) {
        statusLabel = pc.green('enabled');
      } else {
        statusLabel = pc.dim('disabled');
      }
    } else {
      statusLabel = pc.dim('disabled');
    }

    console.log(`  ${pc.cyan('\u2022')} ${pc.bold(agent.label)}`);
    console.log(`    Status:   ${statusLabel}`);
    if (agent.shellEnabledUntil) {
      const remaining = formatTimeRemaining(agent.shellEnabledUntil);
      if (remaining) {
        console.log(`    Expires:  ${pc.cyan(remaining)} remaining`);
      }
    }
    if (agent.shellPolicy) {
      console.log(`    Policy:   ${agent.shellPolicy}`);
    }
    console.log('');
  }
}
