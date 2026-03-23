import pc from 'picocolors';
import * as prompts from '@clack/prompts';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';
import type { TokenResponse } from '../lib/types.js';

/**
 * Create a new join token for agent enrollment.
 */
export async function runTokensCreateCommand(config: CliConfig): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');

  const labelValue = await prompts.text({
    message: 'Agent label for the join token',
    placeholder: 'my-agent',
    validate: (v) => {
      if (!v || !v.match(/^[a-z0-9-]+$/))
        return 'Label must be lowercase letters, numbers, and hyphens';
      return undefined;
    },
  });

  if (prompts.isCancel(labelValue)) {
    console.log(pc.dim('\n  Cancelled.\n'));
    process.exit(0);
  }

  let result: TokenResponse;
  try {
    result = await client.post<TokenResponse>('/api/shell/tokens', { label: labelValue });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`  Failed to create token: ${message}\n`));
    process.exit(1);
  }

  console.log(pc.bold('  Join Token Created'));
  console.log('');
  console.log(`  ${pc.bold(pc.cyan(result.token))}`);
  console.log('');
  console.log(
    pc.dim(`  Use this token to enroll an agent: shell-agent enroll --token <token>`),
  );
  console.log('');
}
