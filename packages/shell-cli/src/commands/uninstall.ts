import pc from 'picocolors';

/**
 * Print manual cleanup instructions for uninstalling the shell CLI.
 */
export async function runUninstallCommand(): Promise<void> {
  console.log('');
  console.log(pc.bold('  Uninstall Shell CLI'));
  console.log(pc.dim('  ' + '\u2500'.repeat(28)));
  console.log('');
  console.log('  To remove the shell CLI configuration:');
  console.log('');
  console.log(`    ${pc.cyan('rm -rf ~/.shell-cli/')}`);
  console.log('');
  console.log(pc.dim('  Note: This only removes the CLI configuration.'));
  console.log(pc.dim('  The shell server and agent are managed separately.'));
  console.log(pc.dim('  API keys at ~/.shell/ are shared with the server.'));
  console.log('');
}
