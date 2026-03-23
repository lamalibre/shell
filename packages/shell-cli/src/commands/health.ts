import pc from 'picocolors';
import type { CliConfig } from '../lib/config.js';
import { buildApiClient } from '../lib/api-client.js';

/**
 * Check if the shell server is online.
 */
export async function runHealthCommand(config: CliConfig): Promise<void> {
  const client = await buildApiClient(config);

  console.log('');

  try {
    await client.get<unknown>('/api/shell/health');
    console.log(`  ${pc.green('Server is online')}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ${pc.red(`Server is unreachable: ${message}`)}`);
  }

  console.log('');
}
