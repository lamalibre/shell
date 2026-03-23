import * as https from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { PortlamaConfig } from './detect.js';
import { createTunnelWithRetry } from './portlama-api.js';
import { installService } from './service.js';
import { detectPlatform } from './detect.js';

const SHELL_DIR = join(homedir(), '.shell');
const SHELL_CLI_DIR = join(homedir(), '.shell-cli');
const LOGS_DIR = join(SHELL_DIR, 'logs');
const SERVER_PORT = 9494;

export async function runTunnelSetup(portlamaConfig: PortlamaConfig): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' create-shell — tunnel mode (via Portlama) ')));

  const platform = detectPlatform();

  // Check for existing installation
  if (existsSync(SHELL_DIR)) {
    const shouldReconfigure = await p.confirm({
      message: 'An existing installation was found at ~/.shell/. Reconfigure?',
    });

    if (p.isCancel(shouldReconfigure) || !shouldReconfigure) {
      p.outro('Setup cancelled.');
      return;
    }
  }

  // Validate Portlama P12 credentials
  if (!portlamaConfig.p12Path || !portlamaConfig.p12Password) {
    p.log.error('Tunnel mode requires P12 credentials in Portlama agent config.');
    p.log.info('Use a P12-enrolled Portlama agent for tunnel mode.');
    p.outro(pc.red('Setup aborted.'));
    process.exit(1);
  }

  // Create directories
  mkdirSync(SHELL_DIR, { mode: 0o700, recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
  p.log.success('Created ~/.shell/ directory');

  // Create Portlama tunnel
  const tunnelSpinner = p.spinner();
  tunnelSpinner.start('Creating Portlama tunnel...');

  let tunnelResult;
  try {
    tunnelResult = await createTunnelWithRetry(portlamaConfig, SERVER_PORT);
    tunnelSpinner.stop(`Tunnel created: ${tunnelResult.fqdn}`);
  } catch (err) {
    tunnelSpinner.stop('Failed to create tunnel');
    const message = err instanceof Error ? err.message : 'Unknown error';
    p.log.error(message);
    p.outro(pc.red('Setup failed.'));
    process.exit(1);
  }

  // Write tunnel.json (atomically via temp file)
  const tunnelConfig = {
    fqdn: tunnelResult.fqdn,
    subdomain: tunnelResult.subdomain,
    tunnelId: tunnelResult.id,
    panelUrl: portlamaConfig.panelUrl,
    portlamaP12Path: portlamaConfig.p12Path,
    portlamaP12Password: portlamaConfig.p12Password,
    createdAt: new Date().toISOString(),
  };

  const tunnelJsonPath = join(SHELL_DIR, 'tunnel.json');
  const tunnelJsonTmp = tunnelJsonPath + '.tmp';
  const fd = openSync(tunnelJsonTmp, 'w', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(tunnelConfig, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tunnelJsonTmp, tunnelJsonPath);
  p.log.success('Tunnel config saved to ~/.shell/tunnel.json');

  // Update Portlama agent config to activate the tunnel
  const updateSpinner = p.spinner();
  updateSpinner.start('Updating Portlama agent configuration...');

  try {
    execFileSync('portlama-agent', ['update'], { stdio: 'pipe' });
    updateSpinner.stop('Portlama agent updated (tunnel active)');
  } catch {
    updateSpinner.stop('Could not run portlama-agent update');
    p.log.warning(
      'Run "portlama-agent update" manually to activate the Chisel tunnel.',
    );
  }

  // Create minimal package.json for npm install
  const packageJsonPath = join(SHELL_DIR, 'package.json');
  writeFileSync(packageJsonPath, JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n');

  // Install packages
  const installSpinner = p.spinner();
  installSpinner.start('Installing @lamalibre/shell-server and @lamalibre/shell-agent...');

  try {
    execFileSync(
      'npm',
      ['install', '--production', '@lamalibre/shell-server', '@lamalibre/shell-agent'],
      { cwd: SHELL_DIR, stdio: 'pipe' },
    );
    installSpinner.stop('Packages installed successfully');
  } catch (err) {
    installSpinner.stop('Failed to install packages');
    const message = err instanceof Error ? err.message : 'Unknown error during npm install';
    p.log.error(message);
    p.outro(pc.red('Setup failed.'));
    process.exit(1);
  }

  // Resolve paths to installed packages
  const serverDistDir = join(SHELL_DIR, 'node_modules', '@lamalibre', 'shell-server', 'dist');
  const nodePath = process.execPath;

  // Start server temporarily to generate CA + API key + join token
  const serverSpinner = p.spinner();
  serverSpinner.start('Starting server to generate certificates (with tunnel SAN)...');

  let joinToken: string;
  try {
    joinToken = await startServerAndCreateToken(nodePath, join(serverDistDir, 'standalone.js'));
    serverSpinner.stop('Server initialized — certificates generated with tunnel hostname');
  } catch (err) {
    serverSpinner.stop('Failed to initialize server');
    const message = err instanceof Error ? err.message : 'Unknown error starting server';
    p.log.error(message);
    p.outro(pc.red('Setup failed.'));
    process.exit(1);
  }

  // Set up CLI config
  mkdirSync(SHELL_CLI_DIR, { recursive: true });
  const cliConfigPath = join(SHELL_CLI_DIR, 'config.json');
  writeFileSync(
    cliConfigPath,
    JSON.stringify(
      {
        serverUrl: `https://${tunnelResult.fqdn}`,
        apiKeyPath: join(SHELL_DIR, 'api-key'),
      },
      null,
      2,
    ) + '\n',
  );
  p.log.success('CLI config written to ~/.shell-cli/config.json');

  // Install server service
  const serviceSpinner = p.spinner();
  serviceSpinner.start('Installing system services...');

  try {
    await installService({
      platform,
      name: 'shell-server',
      execPath: nodePath,
      args: [join(serverDistDir, 'standalone.js')],
      logDir: LOGS_DIR,
    });
    serviceSpinner.stop('System services installed and started');
  } catch (err) {
    serviceSpinner.stop('Failed to install system services');
    const message = err instanceof Error ? err.message : 'Unknown error installing services';
    p.log.error(message);
    p.log.warning(
      'You can start the server manually:\n' + `  node ${join(serverDistDir, 'standalone.js')}`,
    );
  }

  // Print results
  const tunnelUrl = `https://${tunnelResult.fqdn}`;

  p.log.info(
    pc.bold('Shell Server ready (tunnel mode)') +
      '\n\n' +
      `  Tunnel: ${pc.cyan(tunnelUrl)}`,
  );

  p.log.info(
    pc.bold('To connect an agent:') +
      '\n\n' +
      pc.cyan(
        `  npx @lamalibre/create-shell --join \\\n` +
          `    --server ${tunnelUrl} \\\n` +
          `    --token ${joinToken}`,
      ),
  );

  p.outro(pc.green('Tunnel setup complete!'));
}

async function startServerAndCreateToken(nodePath: string, serverScript: string): Promise<string> {
  const serverProcess = spawn(nodePath, [serverScript], {
    cwd: SHELL_DIR,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  try {
    // Wait for server to be ready
    await waitForHealth(30, 1000);

    // Read API key
    const apiKeyPath = join(SHELL_DIR, 'api-key');
    if (!existsSync(apiKeyPath)) {
      throw new Error(
        'API key file not found at ~/.shell/api-key — server may not have initialized correctly',
      );
    }
    const apiKey = readFileSync(apiKeyPath, 'utf8').trim();

    // Create join token
    const token = await createJoinToken(apiKey);
    return token;
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      serverProcess.on('exit', () => resolve());
      setTimeout(() => {
        serverProcess.kill('SIGKILL');
        resolve();
      }, 3000);
    });
  }
}

function waitForHealth(maxRetries: number, intervalMs: number): Promise<void> {
  const healthUrl = `https://localhost:${SERVER_PORT}/api/shell/health`;
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const check = (): void => {
      attempt++;

      const req = https.get(healthUrl, { rejectUnauthorized: false }, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
        } else {
          res.resume();
          retry();
        }
      });

      req.on('error', () => {
        retry();
      });

      req.end();
    };

    const retry = (): void => {
      if (attempt >= maxRetries) {
        reject(new Error(`Server did not become healthy after ${maxRetries} attempts`));
        return;
      }
      setTimeout(check, intervalMs);
    };

    check();
  });
}

function createJoinToken(apiKey: string): Promise<string> {
  const tokensUrl = `https://localhost:${SERVER_PORT}/api/shell/tokens`;
  return new Promise((resolve, reject) => {
    const url = new URL(tokensUrl);

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode !== 200 && res.statusCode !== 201) {
            reject(
              new Error(`Failed to create join token: HTTP ${String(res.statusCode)} — ${body}`),
            );
            return;
          }

          try {
            const data = JSON.parse(body) as { token?: string };
            if (!data.token) {
              reject(new Error('Server response did not include a token'));
              return;
            }
            resolve(data.token);
          } catch {
            reject(new Error(`Invalid JSON response from server: ${body}`));
          }
        });
      },
    );

    req.on('error', (err) => {
      reject(new Error(`Failed to connect to server: ${err.message}`));
    });

    req.write(JSON.stringify({ label: 'agent', ttlMinutes: 60 }));
    req.end();
  });
}
