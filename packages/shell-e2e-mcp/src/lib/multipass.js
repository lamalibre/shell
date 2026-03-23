// ============================================================================
// Multipass CLI Wrapper
// ============================================================================
// Wraps all VM interactions using execa with array arguments (never string
// interpolation). Consistent error handling via allowFailure flag.

import { execa } from 'execa';

/** Default timeout for multipass commands (2 minutes). */
const DEFAULT_TIMEOUT = 120_000;

/**
 * Run a multipass command with array arguments.
 * Returns { stdout, stderr, exitCode }.
 */
async function run(args, { allowFailure = false, timeout = DEFAULT_TIMEOUT } = {}) {
  try {
    const result = await execa('multipass', args, { timeout });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err) {
    if (allowFailure) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.exitCode ?? 1,
      };
    }
    throw err;
  }
}

/** Launch a new VM with the given resource spec. */
export async function launch(name, { cpus = 1, memory = '512M', disk = '10G' } = {}) {
  return run([
    'launch',
    '--name', name,
    '--cpus', String(cpus),
    '--memory', memory,
    '--disk', disk,
    '24.04', // Ubuntu 24.04 LTS
  ], { timeout: 600_000 }); // 10 min for launch
}

/** Delete a VM (with purge). */
export async function deleteVm(name, { allowFailure = true } = {}) {
  await run(['delete', name], { allowFailure });
  await run(['purge'], { allowFailure });
}

/** Get VM info as parsed JSON. Returns null if VM doesn't exist. */
export async function info(name) {
  try {
    const result = await run(['info', name, '--format', 'json']);
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/** Get the IPv4 address of a VM. Returns null if unavailable. */
export async function getIp(name) {
  const data = await info(name);
  try {
    return data?.info?.[name]?.ipv4?.[0] || null;
  } catch {
    return null;
  }
}

/** List all VMs. Returns array of { name, state, ipv4 }. */
export async function list() {
  try {
    const result = await run(['list', '--format', 'json']);
    const data = JSON.parse(result.stdout);
    return (data.list || []).map((vm) => ({
      name: vm.name,
      state: vm.state,
      ipv4: vm.ipv4?.[0] || null,
    }));
  } catch {
    return [];
  }
}

/**
 * Execute a command on a VM.
 * Command can be a string (passed to bash -c) or an array.
 */
export async function exec(vmName, command, { sudo = false, timeout = DEFAULT_TIMEOUT, allowFailure = false } = {}) {
  const args = ['exec', vmName, '--'];

  if (sudo) {
    args.push('sudo', '-n');
  }

  if (Array.isArray(command)) {
    args.push(...command);
  } else {
    args.push('bash', '-c', command);
  }

  return run(args, { allowFailure, timeout });
}

/** Transfer a file from host to VM. */
export async function transfer(localPath, vmDest) {
  return run(['transfer', localPath, vmDest], { timeout: 60_000 });
}

/** Transfer a file from VM to host. */
export async function transferFrom(vmSource, localPath) {
  return run(['transfer', vmSource, localPath], { timeout: 60_000 });
}

/** Create a snapshot of a VM. */
export async function snapshot(vmName, snapshotName) {
  return run(['snapshot', vmName, '--name', snapshotName], { timeout: 300_000 });
}

/** Restore a VM to a snapshot. */
export async function restore(vmName, snapshotName) {
  return run(['restore', `${vmName}.${snapshotName}`, '--destructive'], { timeout: 300_000 });
}

/** List snapshots for a VM. Returns array of snapshot names. */
export async function listSnapshots(vmName) {
  try {
    const result = await run(['list', '--snapshots', '--format', 'json', vmName], {
      allowFailure: true,
    });
    if (result.exitCode !== 0) return [];
    const data = JSON.parse(result.stdout);
    // Format varies — handle both shapes
    if (Array.isArray(data)) return data.map((s) => s.name || s);
    if (data.snapshots) return data.snapshots.map((s) => s.name || s);
    if (data[vmName]) return Object.keys(data[vmName]);
    return [];
  } catch {
    return [];
  }
}

/** Delete a snapshot from a VM. */
export async function deleteSnapshot(vmName, snapshotName) {
  return run(['delete', vmName, '--snapshot', snapshotName, '--purge'], {
    allowFailure: true,
  });
}

/** Check if multipass is installed and running. */
export async function isAvailable() {
  try {
    await run(['version'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
