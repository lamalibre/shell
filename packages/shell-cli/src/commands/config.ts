import pc from 'picocolors';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';
import type { ShellConfigResponse } from '../lib/types.js';

/**
 * Display or update the shell server configuration.
 *
 * Flags:
 *   --enable   Enable shell access globally
 *   --disable  Disable shell access globally
 *   (none)     Show current configuration
 */
export async function runConfigCommand(config: CliConfig, args: string[]): Promise<void> {
  const client = await buildApiClient(config);

  const hasEnable = args.includes('--enable');
  const hasDisable = args.includes('--disable');

  if (hasEnable && hasDisable) {
    console.error(pc.red('\n  Cannot use both --enable and --disable.\n'));
    process.exit(1);
  }

  if (hasEnable || hasDisable) {
    const enabled = hasEnable;
    console.log('');

    try {
      await client.patch<unknown>('/api/shell/config', { enabled });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`  Failed to update config: ${message}\n`));
      process.exit(1);
    }

    const label = enabled ? pc.green('enabled') : pc.red('disabled');
    console.log(`  Shell access ${label}.`);
    console.log('');
    return;
  }

  // Default: show current config
  console.log('');
  console.log(pc.bold('  Shell Configuration'));
  console.log(pc.dim('  ' + '\u2500'.repeat(28)));

  let serverConfig: ShellConfigResponse;
  try {
    serverConfig = await client.get<ShellConfigResponse>('/api/shell/config');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${pc.yellow(`Could not fetch config: ${message}`)}`);
    console.log('');
    return;
  }

  const enabledLabel = serverConfig.enabled ? pc.green('enabled') : pc.red('disabled');

  console.log(`  Status:          ${enabledLabel}`);
  console.log(`  Default policy:  ${serverConfig.defaultPolicy || pc.dim('none')}`);
  console.log(`  Policies:        ${serverConfig.policies.length}`);
  console.log('');
}
