// ============================================================================
// Shell E2E MCP — Configuration & Constants
// ============================================================================

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root of the shell repository. */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** E2E test directory. */
export const E2E_DIR = path.join(REPO_ROOT, 'tests', 'e2e');

/** Temp directory for intermediate run data. */
export const TEMP_DIR = '/tmp/shell-e2e';

/** VM names. */
export const VM_HOST = 'shell-host';
export const VM_AGENT = 'shell-agent';
export const ALL_VMS = [VM_HOST, VM_AGENT];

/** VM short-name → full multipass name mapping. */
export const VM_NAME_MAP = { host: VM_HOST, agent: VM_AGENT };

/** Default server port (inside the VM). */
export const SERVER_PORT = 9494;

/** Default agent label for tests. */
export const AGENT_LABEL = 'test-agent';

/** VM profiles — resource allocation tiers. */
export const PROFILES = {
  production: {
    description: 'Matches $4 DigitalOcean droplet — final publishable runs',
    cpus: 1,
    memory: '512M',
    disk: '10G',
  },
  development: {
    description: 'Fast iteration — comfortable resources for building',
    cpus: 2,
    memory: '2G',
    disk: '10G',
  },
  performance: {
    description: 'Heavy lifting — fast builds, parallel tests',
    cpus: 4,
    memory: '4G',
    disk: '20G',
  },
};

/** Snapshot checkpoints — named save-points in the VM lifecycle. */
export const CHECKPOINTS = {
  'post-create': 'VMs exist but no setup has run',
  'post-setup': 'Both VMs provisioned, server running, agent enrolled and connected',
};
