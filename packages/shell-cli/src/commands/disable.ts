import pc from 'picocolors';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';
import type { DisableResponse } from '../lib/types.js';

/**
 * Disable shell access for an agent.
 */
export async function runDisableCommand(label: string, config: CliConfig): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');

  let result: DisableResponse;
  try {
    result = await client.del<DisableResponse>(`/api/shell/enable/${encodeURIComponent(label)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`\n  Failed to disable shell access: ${message}\n`));
    process.exit(1);
  }

  console.log(pc.green(`  Shell access disabled for ${pc.bold(result.label)}.`));
  console.log('');
}
