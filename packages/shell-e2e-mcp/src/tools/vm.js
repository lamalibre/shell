// ============================================================================
// VM Lifecycle Tools — vm_create, vm_list, vm_delete, vm_exec
// ============================================================================

import { z } from 'zod';
import * as mp from '../lib/multipass.js';
import { setVmState, removeVmState, updateState } from '../lib/state.js';
import { ALL_VMS, VM_NAME_MAP, PROFILES } from '../config.js';

export const vmCreateTool = {
  name: 'vm_create',
  description:
    'Create the Shell E2E VMs (shell-host + shell-agent) with a resource profile. ' +
    'Deletes existing VMs first if they exist. Use env_detect to pick a profile.',
  inputSchema: z.object({
    profile: z
      .enum(['production', 'development', 'performance'])
      .default('development')
      .describe('Resource profile for VMs'),
  }),
  async handler({ profile } = {}) {
    profile = profile || 'development';
    const spec = PROFILES[profile];
    const results = [];

    // Delete existing VMs in parallel (per-VM purge)
    await Promise.all(
      ALL_VMS.map((vm) => mp.deleteVm(vm, { allowFailure: true })),
    );
    results.push('Cleaned up existing VMs');

    // Create VMs in parallel
    const createResults = await Promise.allSettled(
      ALL_VMS.map(async (vmName) => {
        await mp.launch(vmName, {
          cpus: spec.cpus,
          memory: spec.memory,
          disk: spec.disk,
        });
        const ip = await mp.getIp(vmName);
        setVmState(vmName, { ip, profile, state: 'Running' });
        return { name: vmName, ip };
      }),
    );

    const vms = {};
    for (const result of createResults) {
      if (result.status === 'fulfilled') {
        vms[result.value.name] = result.value.ip;
        results.push(`Created ${result.value.name} (${result.value.ip})`);
      } else {
        results.push(`Failed: ${result.reason?.message || 'unknown error'}`);
      }
    }

    updateState({ profile });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ok: true, profile, spec, vms, steps: results },
            null,
            2,
          ),
        },
      ],
    };
  },
};

export const vmListTool = {
  name: 'vm_list',
  description: 'List all Multipass VMs, highlighting Shell E2E VMs.',
  inputSchema: z.object({}),
  async handler() {
    const allVms = await mp.list();
    const e2eVms = allVms.filter((vm) => ALL_VMS.includes(vm.name));
    const otherVms = allVms.filter((vm) => !ALL_VMS.includes(vm.name));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { shellE2e: e2eVms, other: otherVms },
            null,
            2,
          ),
        },
      ],
    };
  },
};

export const vmDeleteTool = {
  name: 'vm_delete',
  description:
    'Delete Shell E2E VMs. Specify a VM by short name (host, agent) or delete all.',
  inputSchema: z.object({
    vm: z
      .enum(['host', 'agent', 'all'])
      .default('all')
      .describe('Which VM to delete (host, agent, or all)'),
  }),
  async handler({ vm } = {}) {
    vm = vm || 'all';
    const targets = vm === 'all' ? ALL_VMS : [VM_NAME_MAP[vm]];
    const results = [];

    await Promise.all(
      targets.map(async (vmName) => {
        await mp.deleteVm(vmName, { allowFailure: true });
        removeVmState(vmName);
        results.push(`Deleted ${vmName}`);
      }),
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, deleted: targets, steps: results }, null, 2),
        },
      ],
    };
  },
};

export const vmExecTool = {
  name: 'vm_exec',
  description:
    'Execute a command on a Shell E2E VM. Use short names: host or agent.',
  inputSchema: z.object({
    vm: z.enum(['host', 'agent']).describe('Target VM'),
    command: z.string().describe('Command to execute'),
    sudo: z.coerce.boolean().default(false).describe('Run with sudo'),
    timeout: z.coerce
      .number()
      .default(120000)
      .describe('Timeout in milliseconds'),
  }),
  async handler({ vm, command, sudo, timeout } = {}) {
    const vmName = VM_NAME_MAP[vm];
    const result = await mp.exec(vmName, command, {
      sudo: sudo ?? false,
      timeout: timeout || 120_000,
      allowFailure: true,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              vm: vmName,
              exitCode: result.exitCode,
              stdout: result.stdout.slice(-2000),
              stderr: result.stderr.slice(-500),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};
