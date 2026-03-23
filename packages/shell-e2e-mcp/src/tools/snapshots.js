// ============================================================================
// Snapshot Tools — snapshot_create, snapshot_restore, snapshot_list
// ============================================================================

import { z } from 'zod';
import { execa } from 'execa';
import * as mp from '../lib/multipass.js';
import { ALL_VMS, CHECKPOINTS } from '../config.js';

export const snapshotCreateTool = {
  name: 'snapshot_create',
  description:
    'Snapshot all Shell E2E VMs at a checkpoint. VMs are stopped, snapshotted, ' +
    'then restarted. Use after provisioning to enable fast iteration.',
  inputSchema: z.object({
    name: z
      .enum(['post-create', 'post-setup', 'custom'])
      .default('post-setup')
      .describe('Checkpoint name'),
    customName: z.string().optional().describe('Custom snapshot name (if name=custom)'),
  }),
  async handler({ name, customName } = {}) {
    const snapshotName = name === 'custom' ? (customName || 'custom') : (name || 'post-setup');
    const results = [];

    // Sync filesystems before stopping
    await Promise.all(
      ALL_VMS.map((vm) =>
        mp.exec(vm, 'sync', { sudo: true, allowFailure: true }),
      ),
    );

    // Stop all VMs
    await Promise.all(
      ALL_VMS.map(async (vm) => {
        await execa('multipass', ['stop', vm], { timeout: 60_000, reject: false });
        results.push(`Stopped ${vm}`);
      }),
    );

    // Snapshot all VMs in parallel
    await Promise.all(
      ALL_VMS.map(async (vm) => {
        await mp.snapshot(vm, snapshotName);
        results.push(`Snapshotted ${vm} as "${snapshotName}"`);
      }),
    );

    // Restart all VMs
    for (const vm of ALL_VMS) {
      try {
        await execa('multipass', ['start', vm], { timeout: 600_000 });
        results.push(`Restarted ${vm}`);
      } catch (err) {
        results.push(`Warning: failed to restart ${vm}: ${err.message}`);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, snapshot: snapshotName, steps: results }, null, 2),
        },
      ],
    };
  },
};

export const snapshotRestoreTool = {
  name: 'snapshot_restore',
  description:
    'Restore all Shell E2E VMs to a previously created snapshot. ' +
    'VMs are stopped, restored, then restarted.',
  inputSchema: z.object({
    name: z.string().describe('Snapshot name to restore (e.g. "post-setup")'),
  }),
  async handler({ name } = {}) {
    const results = [];

    // Stop all VMs
    await Promise.all(
      ALL_VMS.map((vm) =>
        execa('multipass', ['stop', vm], { timeout: 60_000, reject: false }),
      ),
    );
    results.push('Stopped all VMs');

    // Restore in parallel
    await Promise.all(
      ALL_VMS.map(async (vm) => {
        await mp.restore(vm, name);
        results.push(`Restored ${vm} to "${name}"`);
      }),
    );

    // Restart
    for (const vm of ALL_VMS) {
      try {
        await execa('multipass', ['start', vm], { timeout: 600_000 });
        results.push(`Restarted ${vm}`);
      } catch (err) {
        results.push(`Warning: failed to restart ${vm}: ${err.message}`);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, restored: name, steps: results }, null, 2),
        },
      ],
    };
  },
};

export const snapshotListTool = {
  name: 'snapshot_list',
  description: 'List available snapshots for Shell E2E VMs.',
  inputSchema: z.object({}),
  async handler() {
    const entries = await Promise.all(
      ALL_VMS.map(async (vm) => [vm, await mp.listSnapshots(vm)]),
    );

    const snapshots = Object.fromEntries(
      entries.filter(([, snaps]) => snaps.length > 0),
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              snapshots: Object.keys(snapshots).length > 0 ? snapshots : null,
              checkpoints: CHECKPOINTS,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
