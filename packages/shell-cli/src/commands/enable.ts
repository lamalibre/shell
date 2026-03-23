import pc from 'picocolors';
import * as prompts from '@clack/prompts';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';
import type { PoliciesResponse, EnableResponse } from '../lib/types.js';

const DURATION_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
] as const;

/**
 * Enable shell access for an agent with interactive duration and policy selection.
 */
export async function runEnableCommand(label: string, config: CliConfig): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');
  console.log(pc.bold(`  Enable shell access for ${pc.cyan(label)}`));
  console.log('');

  // Select duration
  const duration = await prompts.select({
    message: 'Access duration',
    options: DURATION_OPTIONS.map((opt) => ({
      value: opt.value,
      label: opt.label,
    })),
    initialValue: 15,
  });

  if (prompts.isCancel(duration)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  if (typeof duration === 'symbol') {
    // already handled by isCancel above, but narrows type
    return;
  }

  // Fetch policies for selection
  let policyId: string | undefined;
  try {
    const data = await client.get<PoliciesResponse>('/api/shell/policies');

    if (data.policies.length > 1) {
      const policyOptions = data.policies.map((p) => ({
        value: p.id,
        label:
          p.name +
          (p.id === data.defaultPolicy || p.name === data.defaultPolicy ? ' (default)' : ''),
        ...(p.description ? { hint: p.description } : {}),
      }));

      const selected = await prompts.select({
        message: 'Policy',
        options: policyOptions,
      });

      if (prompts.isCancel(selected)) {
        console.log(pc.dim('\n  Cancelled.\n'));
        process.exit(0);
      }

      policyId = selected;
    } else if (data.policies.length === 1) {
      const onlyPolicy = data.policies[0]!;
      console.log(pc.dim(`  Using policy: ${onlyPolicy.name}`));
      policyId = onlyPolicy.id;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(pc.dim(`  Could not fetch policies (${message}), using default.`));
  }

  // Enable shell access
  console.log('');

  const body: { durationMinutes: number; policyId?: string } = {
    durationMinutes: duration,
  };
  if (policyId !== undefined) {
    body.policyId = policyId;
  }

  let result: EnableResponse;
  try {
    result = await client.post<EnableResponse>(
      `/api/shell/enable/${encodeURIComponent(label)}`,
      body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`\n  Failed to enable shell access: ${message}\n`));
    process.exit(1);
  }

  const until = new Date(result.shellEnabledUntil).toLocaleString();
  console.log(pc.green(`  Shell access enabled for ${pc.bold(label)}.`));
  console.log(`  Expires: ${pc.cyan(until)}`);
  if (result.shellPolicy) {
    console.log(`  Policy:  ${result.shellPolicy}`);
  }
  console.log('');
}
