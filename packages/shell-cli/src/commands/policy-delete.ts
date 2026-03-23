import pc from 'picocolors';
import * as prompts from '@clack/prompts';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';

/**
 * Delete a shell access policy after confirmation.
 */
export async function runPolicyDeleteCommand(
  policyId: string,
  config: CliConfig,
): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');

  const confirmed = await prompts.confirm({
    message: `Delete policy ${pc.bold(policyId)}?`,
  });

  if (prompts.isCancel(confirmed) || !confirmed) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  try {
    await client.del<unknown>(`/api/shell/policies/${encodeURIComponent(policyId)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`\n  Failed to delete policy: ${message}\n`));
    process.exit(1);
  }

  console.log('');
  console.log(pc.green(`  Policy ${pc.bold(policyId)} deleted.`));
  console.log('');
}
