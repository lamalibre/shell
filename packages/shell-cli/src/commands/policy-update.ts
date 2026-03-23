import pc from 'picocolors';
import * as prompts from '@clack/prompts';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';
import type { PoliciesResponse, ShellPolicy } from '../lib/types.js';

/**
 * Interactively update an existing shell access policy.
 */
export async function runPolicyUpdateCommand(
  policyId: string,
  config: CliConfig,
): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');
  console.log(pc.bold(`  Update Shell Policy ${pc.cyan(policyId)}`));
  console.log('');

  // Fetch existing policy
  let existing: ShellPolicy | undefined;
  try {
    const data = await client.get<PoliciesResponse>('/api/shell/policies');
    existing = data.policies.find((p) => p.id === policyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`  Failed to fetch policies: ${message}\n`));
    process.exit(1);
  }

  if (!existing) {
    console.error(pc.red(`  Policy not found: ${policyId}\n`));
    process.exit(1);
  }

  const name = await prompts.text({
    message: 'Policy name',
    defaultValue: existing.name,
    validate: (value) => {
      if (!value.trim()) return 'Name is required';
      return undefined;
    },
  });

  if (prompts.isCancel(name)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  const description = await prompts.text({
    message: 'Description (optional)',
    defaultValue: existing.description,
  });

  if (prompts.isCancel(description)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  const allowedIpsRaw = await prompts.text({
    message: 'Allowed IPs (comma-separated, optional)',
    defaultValue: existing.allowedIps.join(', '),
  });

  if (prompts.isCancel(allowedIpsRaw)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  const deniedIpsRaw = await prompts.text({
    message: 'Denied IPs (comma-separated, optional)',
    defaultValue: existing.deniedIps.join(', '),
  });

  if (prompts.isCancel(deniedIpsRaw)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  const inactivityTimeoutRaw = await prompts.text({
    message: 'Inactivity timeout in seconds (60-7200)',
    defaultValue: String(existing.inactivityTimeout),
    validate: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 60 || num > 7200) {
        return 'Must be a number between 60 and 7200';
      }
      return undefined;
    },
  });

  if (prompts.isCancel(inactivityTimeoutRaw)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  const maxFileSizeRaw = await prompts.text({
    message: 'Max file size in bytes (optional)',
    defaultValue: String(existing.maxFileSize),
  });

  if (prompts.isCancel(maxFileSizeRaw)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  const allowedIps = allowedIpsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const deniedIps = deniedIpsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const inactivityTimeout = parseInt(inactivityTimeoutRaw, 10);
  const maxFileSize = maxFileSizeRaw ? parseInt(maxFileSizeRaw, 10) : undefined;

  const body: Record<string, unknown> = {
    name: name.trim(),
    allowedIps,
    deniedIps,
    inactivityTimeout,
  };
  if (description.trim()) {
    body['description'] = description.trim();
  }
  if (maxFileSize !== undefined && !isNaN(maxFileSize)) {
    body['maxFileSize'] = maxFileSize;
  }

  console.log('');

  try {
    await client.patch<unknown>(
      `/api/shell/policies/${encodeURIComponent(policyId)}`,
      body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`  Failed to update policy: ${message}\n`));
    process.exit(1);
  }

  console.log(pc.green(`  Policy ${pc.bold(policyId)} updated successfully.`));
  console.log('');
}
