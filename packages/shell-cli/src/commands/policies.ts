import pc from 'picocolors';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';
import type { PoliciesResponse } from '../lib/types.js';

/**
 * Display shell access policies.
 */
export async function runPoliciesCommand(config: CliConfig): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');
  console.log(pc.bold('  Shell Policies'));
  console.log(pc.dim('  ' + '\u2500'.repeat(28)));

  let data: PoliciesResponse;
  try {
    data = await client.get<PoliciesResponse>('/api/shell/policies');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${pc.yellow(`Could not fetch policies: ${message}`)}`);
    console.log('');
    return;
  }

  if (data.policies.length === 0) {
    console.log(`  ${pc.dim('No policies configured.')}`);
    console.log('');
    return;
  }

  for (const policy of data.policies) {
    const isDefault = policy.id === data.defaultPolicy || policy.name === data.defaultPolicy;
    const nameLabel = isDefault
      ? `${pc.bold(policy.name)} ${pc.dim('(default)')}`
      : pc.bold(policy.name);

    const ipRulesCount = policy.allowedIps.length + policy.deniedIps.length;
    const blocklistSize =
      policy.commandBlocklist.hardBlocked.length +
      Object.keys(policy.commandBlocklist.restricted).length;

    console.log(`  ${pc.cyan('\u2022')} ${nameLabel}`);
    console.log(`    ID:            ${pc.dim(policy.id)}`);
    if (policy.description) {
      console.log(`    Description:   ${policy.description}`);
    }
    console.log(`    IP rules:      ${ipRulesCount}`);
    console.log(`    Blocklist:     ${blocklistSize} entries`);
    console.log(`    Inactivity:    ${policy.inactivityTimeout}s`);
    console.log('');
  }
}
