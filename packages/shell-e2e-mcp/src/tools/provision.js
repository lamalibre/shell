// ============================================================================
// Provisioning Tools — provision_host, provision_agent, hot_reload
// ============================================================================

import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import * as mp from '../lib/multipass.js';
import { updateState, loadState } from '../lib/state.js';
import { REPO_ROOT, VM_HOST, VM_AGENT, E2E_DIR, AGENT_LABEL } from '../config.js';

/** Transfer the project to a VM via pnpm pack + npm install. */
async function transferProject(vmName) {
  // Create project directory on VM
  await mp.exec(vmName, 'sudo mkdir -p /opt/shell/project && sudo chown -R $(whoami) /opt/shell', {
    sudo: false,
  });

  // Pack each package and transfer
  // Instead of packing, we'll tar the whole project (faster, includes source)
  const tarPath = '/tmp/shell-project.tar.gz';

  // Create tarball excluding node_modules, dist, target, .git
  await execa('tar', [
    'czf', tarPath,
    '--exclude=node_modules',
    '--exclude=dist',
    '--exclude=.git',
    '--exclude=src-tauri/target',
    '-C', path.dirname(REPO_ROOT),
    path.basename(REPO_ROOT),
  ], { timeout: 60_000 });

  // Transfer to VM
  await mp.transfer(tarPath, `${vmName}:/tmp/shell-project.tar.gz`);

  // Extract on VM
  await mp.exec(vmName, 'tar xzf /tmp/shell-project.tar.gz -C /opt/shell/project --strip-components=1', {
    timeout: 60_000,
  });

  // Clean up local tarball
  fs.unlinkSync(tarPath);
}

/** Transfer E2E test scripts to a VM. */
async function transferTestScripts(vmName) {
  await mp.exec(vmName, 'mkdir -p /tmp/e2e', { allowFailure: true });

  const files = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.sh'));
  await Promise.all(
    files.map((file) =>
      mp.transfer(
        path.join(E2E_DIR, file),
        `${vmName}:/tmp/e2e/${file}`,
      ),
    ),
  );

  // Make executable
  await mp.exec(vmName, 'chmod +x /tmp/e2e/*.sh', { allowFailure: true });
}

export const provisionHostTool = {
  name: 'provision_host',
  description:
    'Full host VM provisioning: transfer project, install Node.js 22, pnpm, ' +
    'build packages, set up shell-server as systemd service, extract credentials. ' +
    'VM must already be created with vm_create.',
  inputSchema: z.object({}),
  async handler() {
    const steps = [];

    try {
      // Transfer project
      steps.push('Transferring project to host VM...');
      await transferProject(VM_HOST);
      steps.push('Project transferred');

      // Transfer VM setup scripts
      const setupDir = path.join(E2E_DIR, 'vm');
      await mp.transfer(
        path.join(setupDir, 'setup-host.sh'),
        `${VM_HOST}:/tmp/setup-host.sh`,
      );
      steps.push('Setup script transferred');

      // Transfer E2E test scripts
      await transferTestScripts(VM_HOST);
      steps.push('E2E test scripts transferred');

      // Run setup
      steps.push('Running setup-host.sh (this takes a few minutes)...');
      const result = await mp.exec(VM_HOST, 'bash /tmp/setup-host.sh', {
        sudo: false,
        timeout: 600_000, // 10 minutes for full setup
        allowFailure: true,
      });

      if (result.exitCode !== 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  error: 'Host setup failed',
                  steps,
                  stdout: result.stdout.slice(-2000),
                  stderr: result.stderr.slice(-1000),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      steps.push('Host setup completed');

      // Extract credentials from VM
      const credsResult = await mp.exec(
        VM_HOST,
        'cat /tmp/shell-test-credentials.json',
        { allowFailure: true },
      );

      let credentials = null;
      if (credsResult.exitCode === 0) {
        try {
          credentials = JSON.parse(credsResult.stdout);
          updateState({ credentials });
          steps.push(`Credentials extracted (API key: ${credentials.apiKey?.slice(0, 8)}...)`);
        } catch {
          steps.push('Warning: could not parse credentials JSON');
        }
      }

      // Get host IP
      const hostIp = await mp.getIp(VM_HOST);
      steps.push(`Host IP: ${hostIp}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                hostIp,
                credentials: credentials
                  ? {
                      serverUrl: credentials.serverUrl,
                      agentLabel: credentials.agentLabel,
                      apiKeyPresent: !!credentials.apiKey,
                    }
                  : null,
                steps,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { ok: false, error: err.message, steps },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
};

export const provisionAgentTool = {
  name: 'provision_agent',
  description:
    'Agent VM provisioning: transfer project, install Node.js 22, tmux, pnpm, ' +
    'build packages, enroll agent with host server, start agent daemon. ' +
    'Host must be provisioned first (credentials needed).',
  inputSchema: z.object({}),
  async handler() {
    const steps = [];
    const state = loadState();

    if (!state.credentials) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: false,
                error: 'No credentials found. Run provision_host first.',
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    try {
      // Transfer project
      steps.push('Transferring project to agent VM...');
      await transferProject(VM_AGENT);
      steps.push('Project transferred');

      // Transfer setup script
      const setupDir = path.join(E2E_DIR, 'vm');
      await mp.transfer(
        path.join(setupDir, 'setup-agent.sh'),
        `${VM_AGENT}:/tmp/setup-agent.sh`,
      );
      steps.push('Setup script transferred');

      // Transfer CA cert from host to agent
      const caCertLocal = '/tmp/shell-e2e-ca.crt';
      try {
        await mp.transferFrom(`${VM_HOST}:/tmp/shell-test-credentials.json`, '/tmp/shell-host-creds.json');
        const hostCreds = JSON.parse(fs.readFileSync('/tmp/shell-host-creds.json', 'utf-8'));
        await mp.transferFrom(`${VM_HOST}:${hostCreds.caCertPath}`, caCertLocal);
        await mp.transfer(caCertLocal, `${VM_AGENT}:/tmp/ca.crt`);
        steps.push('CA cert transferred from host to agent');
      } catch (err) {
        steps.push(`Warning: CA cert transfer failed: ${err.message}`);
      } finally {
        try { fs.unlinkSync(caCertLocal); } catch {}
        try { fs.unlinkSync('/tmp/shell-host-creds.json'); } catch {}
      }

      // Write credentials file for agent setup script
      const hostIp = await mp.getIp(VM_HOST);
      const agentCreds = {
        serverUrl: `https://${hostIp}:9494`,
        joinToken: state.credentials.joinToken,
        agentLabel: state.credentials.agentLabel || AGENT_LABEL,
        caCertPath: '/tmp/ca.crt',
      };

      const credsLocalPath = '/tmp/shell-agent-credentials.json';
      fs.writeFileSync(credsLocalPath, JSON.stringify(agentCreds, null, 2), { mode: 0o600 });
      await mp.transfer(credsLocalPath, `${VM_AGENT}:/tmp/shell-agent-credentials.json`);
      fs.unlinkSync(credsLocalPath);
      steps.push('Agent credentials transferred');

      // Run setup
      steps.push('Running setup-agent.sh...');
      const result = await mp.exec(VM_AGENT, 'bash /tmp/setup-agent.sh', {
        sudo: false,
        timeout: 600_000,
        allowFailure: true,
      });

      if (result.exitCode !== 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  error: 'Agent setup failed',
                  steps,
                  stdout: result.stdout.slice(-2000),
                  stderr: result.stderr.slice(-1000),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      steps.push('Agent setup completed');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, steps }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { ok: false, error: err.message, steps },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
};

export const hotReloadTool = {
  name: 'hot_reload',
  description:
    'Re-deploy a single package to VMs without full reprovisioning. ' +
    'Builds the package locally, transfers, and restarts the relevant service.',
  inputSchema: z.object({
    package: z
      .enum(['shell-server', 'shell-agent', 'shell-cli'])
      .describe('Package to rebuild and redeploy'),
  }),
  async handler({ package: pkgName } = {}) {
    const steps = [];

    try {
      // Build locally
      steps.push(`Building ${pkgName}...`);
      await execa('pnpm', ['--filter', `@lamalibre/${pkgName}`, 'run', 'build'], {
        cwd: REPO_ROOT,
        timeout: 60_000,
      });
      steps.push('Built');

      // Determine target VM and service
      const targetVm = pkgName === 'shell-agent' ? VM_AGENT : VM_HOST;
      const serviceName = pkgName === 'shell-cli' ? null : pkgName;

      // Re-transfer project
      steps.push(`Transferring to ${targetVm}...`);
      await transferProject(targetVm);
      steps.push('Transferred');

      // Rebuild on VM
      steps.push('Building on VM...');
      await mp.exec(targetVm, 'cd /opt/shell/project && pnpm install --frozen-lockfile && pnpm build', {
        timeout: 300_000,
      });
      steps.push('Built on VM');

      // Restart service if applicable
      if (serviceName) {
        await mp.exec(targetVm, `sudo systemctl restart ${serviceName}`, {
          sudo: false,
          allowFailure: true,
        });
        steps.push(`Restarted ${serviceName} service`);

        // Verify
        const statusResult = await mp.exec(
          targetVm,
          `systemctl is-active ${serviceName}`,
          { sudo: true, allowFailure: true },
        );
        steps.push(`Service status: ${statusResult.stdout.trim()}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, steps }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { ok: false, error: err.message, steps },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
};
