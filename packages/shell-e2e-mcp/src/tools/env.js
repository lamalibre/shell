// ============================================================================
// Environment Tools — env_detect, env_status
// ============================================================================

import { z } from 'zod';
import { execa } from 'execa';
import { detectHardware, recommendProfile } from '../lib/profiles.js';
import * as mp from '../lib/multipass.js';
import { loadState } from '../lib/state.js';
import { listRuns, readSummary } from '../lib/logs.js';
import { ALL_VMS, VM_HOST, PROFILES } from '../config.js';

export const envDetectTool = {
  name: 'env_detect',
  description:
    'Detect hardware capabilities and recommend a VM profile for Shell E2E tests. ' +
    'Checks prerequisites: Node.js >= 22, Multipass, tmux, curl, jq, pnpm.',
  inputSchema: z.object({}),
  async handler() {
    const hardware = detectHardware();
    const recommendation = recommendProfile(hardware);
    const checks = [];

    // Node.js
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    checks.push({
      name: 'Node.js',
      ok: nodeMajor >= 22,
      version: nodeVersion,
      required: '>=22',
    });

    // Multipass
    const mpAvailable = await mp.isAvailable();
    if (mpAvailable) {
      try {
        const { stdout } = await execa('multipass', ['version']);
        checks.push({ name: 'Multipass', ok: true, version: stdout.split('\n')[0] });
      } catch {
        checks.push({ name: 'Multipass', ok: true, version: 'unknown' });
      }
    } else {
      checks.push({ name: 'Multipass', ok: false, hint: 'Install from https://multipass.run' });
    }

    // tmux, curl, jq, pnpm
    for (const [cmd, hint] of [
      ['tmux', 'brew install tmux'],
      ['curl', null],
      ['jq', 'brew install jq'],
      ['pnpm', 'npm install -g pnpm'],
    ]) {
      try {
        const flag = cmd === 'tmux' ? '-V' : '--version';
        const { stdout } = await execa(cmd, [flag]);
        checks.push({ name: cmd, ok: true, version: stdout.split('\n')[0].trim() });
      } catch {
        checks.push({ name: cmd, ok: false, ...(hint ? { hint } : {}) });
      }
    }

    const allOk = checks.every((c) => c.ok);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: allOk,
              hardware: {
                cpus: hardware.cpus,
                totalMemoryGB: hardware.totalMemoryGB,
                freeMemoryGB: hardware.freeMemoryGB,
              },
              recommended: recommendation,
              profiles: PROFILES,
              checks,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

export const envStatusTool = {
  name: 'env_status',
  description:
    'Full environment health check: VM state, service status, snapshots, ' +
    'last test run, credentials. Shows everything needed to decide next action.',
  inputSchema: z.object({}),
  async handler() {
    const state = loadState();

    // Query VM info and snapshots in parallel
    const [vmInfos, snapshotEntries] = await Promise.all([
      Promise.all(ALL_VMS.map(async (vmName) => [vmName, await mp.info(vmName)])),
      Promise.all(ALL_VMS.map(async (vmName) => [vmName, await mp.listSnapshots(vmName)])),
    ]);

    // Build VM status map
    const vms = {};
    for (const [vmName, vmInfo] of vmInfos) {
      if (vmInfo?.info?.[vmName]) {
        const vm = vmInfo.info[vmName];
        vms[vmName] = {
          state: vm.state,
          ipv4: vm.ipv4?.[0] || null,
          cpus: vm.cpu_count,
          memory: vm.memory?.total
            ? `${Math.round(vm.memory.total / (1024 * 1024))}M`
            : null,
          disk: vm.disk?.total
            ? `${Math.round(vm.disk.total / (1024 * 1024 * 1024))}G`
            : null,
        };
      } else {
        vms[vmName] = { state: 'not-found' };
      }
    }

    // Check services on host VM if running
    let services = null;
    if (vms[VM_HOST]?.state === 'Running') {
      const serviceNames = ['shell-server'];
      const serviceResults = await Promise.all(
        serviceNames.map(async (svc) => {
          const result = await mp.exec(
            VM_HOST,
            `systemctl is-active ${svc} 2>/dev/null | head -1`,
            { sudo: true, allowFailure: true },
          );
          return [svc, result.stdout.trim() || 'unknown'];
        }),
      );
      services = Object.fromEntries(serviceResults);
    }

    // Snapshots
    const snapshots = Object.fromEntries(
      snapshotEntries.filter(([, snaps]) => snaps.length > 0),
    );

    // Last run
    const runs = listRuns();
    let lastRun = null;
    if (runs.length > 0) {
      lastRun = readSummary(runs[0]);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              vms,
              profile: state.profile,
              services,
              snapshots: Object.keys(snapshots).length > 0 ? snapshots : null,
              lastRun: lastRun
                ? {
                    id: lastRun.runId,
                    passed: lastRun.passed,
                    failed: lastRun.failed,
                    skipped: lastRun.skipped,
                    durationMs: lastRun.durationMs,
                  }
                : null,
              hasCredentials: !!state.credentials,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
