// ============================================================================
// Hardware Detection & VM Profile Recommendation
// ============================================================================

import os from 'node:os';
import { PROFILES, ALL_VMS } from '../config.js';

/** Detect host hardware capabilities. */
export function detectHardware() {
  const cpus = os.cpus().length;
  const totalMemoryGB = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
  const freeMemoryGB = Math.round((os.freemem() / (1024 ** 3)) * 10) / 10;
  return { cpus, totalMemoryGB, freeMemoryGB };
}

/** Parse a memory string like "2G" or "512M" into megabytes. */
function parseMemoryMB(memStr) {
  const match = memStr.match(/^(\d+(?:\.\d+)?)\s*([MG])$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  return unit === 'G' ? value * 1024 : value;
}

/**
 * Recommend a VM profile based on available hardware.
 * Reserves 2GB RAM and 2 CPUs for the host OS.
 * Shell uses 2 VMs (host + agent).
 */
export function recommendProfile(hardware) {
  const vmCount = ALL_VMS.length;
  const reservedCpus = 2;
  const reservedMemoryMB = 2048;

  const availableCpus = Math.max(1, hardware.cpus - reservedCpus);
  const availableMemoryMB = Math.max(512, hardware.freeMemoryGB * 1024 - reservedMemoryMB);

  const supported = [];

  // Check profiles in preference order: performance → development → production
  for (const [name, spec] of Object.entries(PROFILES).reverse()) {
    const neededCpus = spec.cpus * vmCount;
    const neededMemoryMB = parseMemoryMB(spec.memory) * vmCount;

    if (neededCpus <= availableCpus && neededMemoryMB <= availableMemoryMB) {
      supported.push(name);
    }
  }

  // Production always fits (512M × 2 = 1GB, 1 CPU × 2 = 2)
  if (!supported.includes('production')) {
    supported.push('production');
  }

  // Prefer most capable profile
  const preference = ['performance', 'development', 'production'];
  const profile = preference.find((p) => supported.includes(p)) || 'production';

  const totalNeededMB = parseMemoryMB(PROFILES[profile].memory) * vmCount;
  const note =
    totalNeededMB > availableMemoryMB
      ? `${profile} profile may be tight on memory (need ${totalNeededMB}MB, ~${Math.round(availableMemoryMB)}MB available)`
      : `${profile} profile fits comfortably`;

  return { profile, name: profile, supported, note };
}
