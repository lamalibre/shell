declare const __PKG_VERSION__: string;

import pc from 'picocolors';

const NODE_MAJOR = parseInt(process.versions.node.split('.')[0]!, 10);
if (NODE_MAJOR < 22) {
  console.error(`create-shell requires Node.js >= 22. Current: ${process.version}`);
  process.exit(1);
}

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(__PKG_VERSION__);
  process.exit(0);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (process.argv.includes('--uninstall')) {
  printUninstallInstructions();
  process.exit(0);
}

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

async function main(): Promise<void> {
  const isJoin = process.argv.includes('--join');
  const isTunnel = process.argv.includes('--tunnel');

  if (isJoin) {
    const { runAgentSetup } = await import('./lib/agent-setup.js');
    await runAgentSetup({
      server: getFlag('--server'),
      token: getFlag('--token'),
      label: getFlag('--label'),
    });
    return;
  }

  // Check for Portlama and offer tunnel mode
  const { detectPortlama } = await import('./lib/detect.js');
  const portlamaConfig = detectPortlama();

  if (isTunnel) {
    if (!portlamaConfig) {
      const pc = (await import('picocolors')).default;
      console.error(pc.red('--tunnel requires Portlama agent config at ~/.portlama/agent.json'));
      process.exit(1);
    }
    const { runTunnelSetup } = await import('./lib/tunnel-setup.js');
    await runTunnelSetup(portlamaConfig);
    return;
  }

  if (portlamaConfig) {
    const p = await import('@clack/prompts');
    const mode = await p.select({
      message: 'Portlama detected. Choose deployment mode:',
      options: [
        { value: 'tunnel', label: 'Tunnel mode (via Portlama)', hint: 'exposed via Chisel reverse tunnel' },
        { value: 'standalone', label: 'Standalone (local network only)', hint: 'direct mTLS connections' },
      ],
    });

    if (p.isCancel(mode)) {
      p.outro('Setup cancelled.');
      return;
    }

    if (mode === 'tunnel') {
      const { runTunnelSetup } = await import('./lib/tunnel-setup.js');
      await runTunnelSetup(portlamaConfig);
      return;
    }
  }

  const { runStandaloneSetup } = await import('./lib/standalone-setup.js');
  await runStandaloneSetup();
}

main().catch((err: unknown) => {
  console.error(pc.red('Fatal error:'), err instanceof Error ? err.message : String(err));
  process.exit(1);
});

function printHelp(): void {
  console.log(`
${pc.bold('create-shell')} v${__PKG_VERSION__}

${pc.dim('Set up a shell server + agent, or enroll an agent with an existing server.')}

${pc.bold('Usage:')}
  npx @lamalibre/create-shell                                        Interactive setup (auto-detects Portlama)
  npx @lamalibre/create-shell --tunnel                               Force tunnel mode (requires Portlama)
  npx @lamalibre/create-shell --join                                 Interactive agent enrollment
  npx @lamalibre/create-shell --join --server <url> --token <token>  Non-interactive enrollment
  npx @lamalibre/create-shell --uninstall                            Print uninstall instructions
  npx @lamalibre/create-shell --version                              Print version
  npx @lamalibre/create-shell --help                                 Print this help

${pc.bold('Options:')}
  --join              Enroll as an agent with an existing server
  --tunnel            Force tunnel mode via Portlama (requires ~/.portlama/agent.json)
  --server <url>      Server URL (used with --join)
  --token <token>     Join token (used with --join)
  --label <name>      Agent label (used with --join)
  --uninstall         Print uninstall instructions
  --version, -v       Print version
  --help, -h          Print help

${pc.bold('Deployment Modes:')}
  ${pc.dim('Standalone')}   Direct network, own CA, mTLS auth
  ${pc.dim('Tunnel')}       Via Portlama reverse tunnel, ticket-based auth
  ${pc.dim('Plugin')}       Inside Portlama panel (not set up via create-shell)
`);
}

function printUninstallInstructions(): void {
  const platform = process.platform;

  console.log(`
${pc.bold('Uninstall create-shell')}

${pc.bold('1. Stop and remove services:')}
`);

  if (platform === 'darwin') {
    console.log(`  ${pc.cyan('# macOS (launchd)')}
  launchctl unload ~/Library/LaunchAgents/com.lamalibre.shell-server.plist 2>/dev/null
  launchctl unload ~/Library/LaunchAgents/com.lamalibre.shell-agent.plist 2>/dev/null
  rm -f ~/Library/LaunchAgents/com.lamalibre.shell-server.plist
  rm -f ~/Library/LaunchAgents/com.lamalibre.shell-agent.plist
`);
  } else {
    console.log(`  ${pc.cyan('# Linux (systemd)')}
  systemctl --user disable --now shell-server 2>/dev/null
  systemctl --user disable --now shell-agent 2>/dev/null
  rm -f ~/.config/systemd/user/shell-server.service
  rm -f ~/.config/systemd/user/shell-agent.service
  systemctl --user daemon-reload
`);
  }

  console.log(`${pc.bold('2. Remove data directories:')}

  rm -rf ~/.shell/
  rm -rf ~/.shell-cli/
  rm -rf ~/.shell-agent/

${pc.bold('3. Tunnel mode cleanup (if applicable):')}

  ${pc.dim('# Remove the tunnel from Portlama (check tunnel ID in ~/.shell/tunnel.json first)')}
  ${pc.dim('# The tunnel will be automatically cleaned up when the Portlama agent is removed')}
`);
}
