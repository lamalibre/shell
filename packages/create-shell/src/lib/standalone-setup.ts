import * as https from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { detectPlatform, detectTmux } from './detect.js';
import { installService } from './service.js';

const SHELL_DIR = join(homedir(), '.shell');
const SHELL_CLI_DIR = join(homedir(), '.shell-cli');
const LOGS_DIR = join(SHELL_DIR, 'logs');
const SERVER_PORT = 9494;
const HEALTH_URL = `https://localhost:${SERVER_PORT}/api/shell/health`;
const TOKENS_URL = `https://localhost:${SERVER_PORT}/api/shell/tokens`;

export async function runStandaloneSetup(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' create-shell — standalone server + agent ')));

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

  // Create directories
  mkdirSync(SHELL_DIR, { mode: 0o700, recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
  p.log.success('Created ~/.shell/ directory');

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
  serverSpinner.start('Starting server to generate certificates and API key...');

  let joinToken: string;
  try {
    joinToken = await startServerAndCreateToken(nodePath, join(serverDistDir, 'standalone.js'));
    serverSpinner.stop('Server initialized — certificates and API key generated');
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
        serverUrl: `https://localhost:${SERVER_PORT}`,
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
  p.log.info(
    pc.bold('Join token for enrolling agents on other machines:') +
      '\n\n' +
      pc.cyan(
        `  npx @lamalibre/create-shell --join --server https://<server-ip>:${SERVER_PORT} --token ${joinToken}`,
      ),
  );

  p.log.info(
    pc.bold('Enroll the local agent:') +
      '\n\n' +
      pc.cyan(
        `  npx @lamalibre/create-shell --join --server https://localhost:${SERVER_PORT} --token ${joinToken}`,
      ),
  );

  p.outro(pc.green('Server setup complete!'));
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
    // Give it a moment to shut down gracefully
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
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const check = (): void => {
      attempt++;

      const req = https.get(HEALTH_URL, { rejectUnauthorized: false }, (res) => {
        if (res.statusCode === 200) {
          // Consume response data to free up memory
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
  return new Promise((resolve, reject) => {
    const url = new URL(TOKENS_URL);

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
