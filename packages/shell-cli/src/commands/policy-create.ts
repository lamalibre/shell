import pc from 'picocolors';
import * as prompts from '@clack/prompts';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';

/**
 * Interactively create a new shell access policy.
 */
export async function runPolicyCreateCommand(config: CliConfig): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');
  console.log(pc.bold('  Create Shell Policy'));
  console.log('');

  const name = await prompts.text({
    message: 'Policy name',
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
    defaultValue: '',
  });

  if (prompts.isCancel(description)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  const allowedIpsRaw = await prompts.text({
    message: 'Allowed IPs (comma-separated, optional)',
    defaultValue: '',
  });

  if (prompts.isCancel(allowedIpsRaw)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  const deniedIpsRaw = await prompts.text({
    message: 'Denied IPs (comma-separated, optional)',
    defaultValue: '',
  });

  if (prompts.isCancel(deniedIpsRaw)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  const inactivityTimeoutRaw = await prompts.text({
    message: 'Inactivity timeout in seconds (60-7200)',
    defaultValue: '600',
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
    defaultValue: '104857600',
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

  let result: { ok: boolean; policy: { id: string } };
  try {
    result = await client.post<{ ok: boolean; policy: { id: string } }>(
      '/api/shell/policies',
      body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`  Failed to create policy: ${message}\n`));
    process.exit(1);
  }

  console.log(pc.green(`  Policy created successfully.`));
  console.log(`  ID: ${pc.bold(result.policy.id)}`);
  console.log('');
}
