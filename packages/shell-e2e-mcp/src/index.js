// ============================================================================
// Shell E2E MCP Server
// ============================================================================
// MCP server for managing the Shell E2E test infrastructure: VM lifecycle,
// snapshots, provisioning, test execution with dependency resolution, and
// two-tier logging. All tests run on Multipass VMs — never on the host.
//
// Usage:
//   node src/index.js              # stdio transport (for Claude Code)
//   shell-e2e-mcp --server         # via bin link
//
// Tools:
//   env_detect          — detect hardware, recommend VM profile
//   env_status          — full environment health check
//   vm_create           — create VMs with resource profile
//   vm_list             — list running VMs
//   vm_delete           — tear down VMs
//   vm_exec             — execute command on a VM
//   snapshot_create     — snapshot VMs at checkpoint
//   snapshot_restore    — restore VMs to checkpoint
//   snapshot_list       — list available snapshots
//   provision_host      — full host provisioning pipeline
//   provision_agent     — agent setup with cert transfer
//   hot_reload          — re-deploy a single package
//   test_run            — run a test with dependency resolution
//   test_run_all        — run full test suite
//   test_list           — list tests with dependency graph
//   test_reset          — reset state between tests
//   test_log            — fetch raw log for a test run
// ============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { envDetectTool, envStatusTool } from './tools/env.js';
import { vmCreateTool, vmListTool, vmDeleteTool, vmExecTool } from './tools/vm.js';
import {
  snapshotCreateTool,
  snapshotRestoreTool,
  snapshotListTool,
} from './tools/snapshots.js';
import {
  provisionHostTool,
  provisionAgentTool,
  hotReloadTool,
} from './tools/provision.js';
import {
  testRunTool,
  testRunAllTool,
  testListTool,
  testResetTool,
  testLogTool,
} from './tools/tests.js';

const server = new McpServer({
  name: 'shell-e2e',
  version: '0.1.0',
});

// Register all tools
const tools = [
  envDetectTool,
  envStatusTool,
  vmCreateTool,
  vmListTool,
  vmDeleteTool,
  vmExecTool,
  snapshotCreateTool,
  snapshotRestoreTool,
  snapshotListTool,
  provisionHostTool,
  provisionAgentTool,
  hotReloadTool,
  testRunTool,
  testRunAllTool,
  testListTool,
  testResetTool,
  testLogTool,
];

for (const tool of tools) {
  // MCP SDK expects raw Zod shape ({ key: z.string() }), not z.object({ ... })
  const shape = tool.inputSchema.shape || {};
  server.tool(tool.name, tool.description, shape, async (args) => {
    return tool.handler(args || {});
  });
}

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
