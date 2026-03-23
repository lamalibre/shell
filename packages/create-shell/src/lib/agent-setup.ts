import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { detectPlatform, detectTmux, detectPortlama } from './detect.js';
import { installService } from './service.js';

const SHELL_DIR = join(homedir(), '.shell');
const LOGS_DIR = join(SHELL_DIR, 'logs');

export interface AgentSetupOpts {
  server?: string | undefined;
  token?: string | undefined;
  label?: string | undefined;
}

export async function runAgentSetup(opts?: AgentSetupOpts): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' create-shell — agent enrollment ')));

  const platform = detectPlatform();
  if (platform === 'unsupported') {
    p.log.error('Unsupported platform. Only macOS and Linux are supported.');
    p.outro(pc.red('Setup aborted.'));
    process.exit(1);
  }

  const hasTmux = detectTmux();
  if (!hasTmux) {
    p.log.error(
      'tmux is required but not found in PATH. Install it first:\n' +
        (platform === 'darwin' ? '  brew install tmux' : '  sudo apt install tmux'),
    );
    p.outro(pc.red('Setup aborted.'));
    process.exit(1);
  }

  // Gather server URL and token — prompt if not provided
  let serverUrl = opts?.server;
  let token = opts?.token;
  const label = opts?.label;

  if (!serverUrl) {
    const serverInput = await p.text({
      message: 'Server URL:',
      placeholder: 'https://your-server:9494',
      validate: (value) => {
        if (!value) return 'Server URL is required';
        try {
          new URL(value);
        } catch {
          return 'Invalid URL format';
        }
        return undefined;
      },
    });

    if (p.isCancel(serverInput)) {
      p.outro('Setup cancelled.');
      return;
    }
    serverUrl = serverInput;
  }

  if (!token) {
    const tokenInput = await p.text({
      message: 'Join token:',
      placeholder: 'Paste the token from your server admin',
      validate: (value) => {
        if (!value) return 'Join token is required';
        return undefined;
      },
    });

    if (p.isCancel(tokenInput)) {
      p.outro('Setup cancelled.');
      return;
    }
    token = tokenInput;
  }

  // Create directories
  mkdirSync(SHELL_DIR, { mode: 0o700, recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });

  // Create minimal package.json for npm install
  const packageJsonPath = join(SHELL_DIR, 'package.json');
  if (!existsSync(packageJsonPath)) {
    writeFileSync(
      packageJsonPath,
      JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n',
    );
  }

  // Install shell-agent
  const installSpinner = p.spinner();
  installSpinner.start('Installing @lamalibre/shell-agent...');

  try {
    execFileSync('npm', ['install', '--production', '@lamalibre/shell-agent'], {
      cwd: SHELL_DIR,
      stdio: 'pipe',
    });
    installSpinner.stop('Package installed successfully');
  } catch (err) {
    installSpinner.stop('Failed to install package');
    const message = err instanceof Error ? err.message : 'Unknown error during npm install';
    p.log.error(message);
    p.outro(pc.red('Setup failed.'));
    process.exit(1);
  }

  // Run enrollment
  const enrollSpinner = p.spinner();
  enrollSpinner.start('Enrolling agent with server...');

  const agentCliPath = join(
    SHELL_DIR,
    'node_modules',
    '@lamalibre',
    'shell-agent',
    'dist',
    'cli.js',
  );
  const nodePath = process.execPath;

  const enrollArgs = [agentCliPath, 'enroll', '--server', serverUrl, '--token', token];

  if (label) {
    enrollArgs.push('--label', label);
  }

  try {
    execFileSync(nodePath, enrollArgs, { cwd: SHELL_DIR, stdio: 'pipe' });
    enrollSpinner.stop('Agent enrolled successfully');
  } catch (err) {
    enrollSpinner.stop('Enrollment failed');
    const message = err instanceof Error ? err.message : 'Unknown error during enrollment';
    p.log.error(message);
    p.outro(pc.red('Setup failed.'));
    process.exit(1);
  }

  // Detect tunnel mode: if server URL is a tunnel FQDN and Portlama is present,
  // upgrade agent config from standalone to tunnel mode
  const portlamaConfig = detectPortlama();
  if (portlamaConfig && portlamaConfig.p12Path && portlamaConfig.p12Password) {
    // Check if server URL looks like a tunnel (not localhost/IP with port)
    try {
      const serverHost = new URL(serverUrl).hostname;
      const isTunnel = serverHost.includes(portlamaConfig.domain) && serverHost.endsWith('-shell.' + portlamaConfig.domain);

      if (isTunnel) {
        const upgradeSpinner = p.spinner();
        upgradeSpinner.start('Detected tunnel server — upgrading agent config...');

        try {
          const agentConfigPath = join(homedir(), '.shell-agent', 'agent.json');
          if (existsSync(agentConfigPath)) {
            const agentConfig = JSON.parse(readFileSync(agentConfigPath, 'utf-8')) as Record<string, unknown>;
            const tunnelConfig = {
              mode: 'tunnel',
              serverUrl: agentConfig['serverUrl'],
              panelUrl: portlamaConfig.panelUrl,
              label: agentConfig['label'],
              portlamaP12Path: portlamaConfig.p12Path,
              portlamaP12Password: portlamaConfig.p12Password,
            };
            const tmpPath = agentConfigPath + '.tmp';
            const fd = openSync(tmpPath, 'w', 0o600);
            try {
              writeFileSync(fd, JSON.stringify(tunnelConfig, null, 2) + '\n');
              fsyncSync(fd);
            } finally {
              closeSync(fd);
            }
            renameSync(tmpPath, agentConfigPath);
            upgradeSpinner.stop('Agent config upgraded to tunnel mode');
          } else {
            upgradeSpinner.stop('Agent config not found — skipping tunnel upgrade');
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          upgradeSpinner.stop(`Could not upgrade to tunnel mode: ${message}`);
        }
      }
    } catch {
      // URL parsing failed — skip tunnel detection
    }
  }

  // Install agent service
  const serviceSpinner = p.spinner();
  serviceSpinner.start('Installing agent service...');

  try {
    await installService({
      platform,
      name: 'shell-agent',
      execPath: nodePath,
      args: [agentCliPath, 'serve'],
      logDir: LOGS_DIR,
    });
    serviceSpinner.stop('Agent service installed and started');
  } catch (err) {
    serviceSpinner.stop('Failed to install agent service');
    const message = err instanceof Error ? err.message : 'Unknown error installing service';
    p.log.error(message);
    p.log.warning('You can start the agent manually:\n' + `  node ${agentCliPath} serve`);
  }

  p.outro(pc.green('Agent enrolled and running!'));
}
