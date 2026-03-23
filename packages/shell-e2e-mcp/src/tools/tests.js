// ============================================================================
// Test Execution Tools — test_run, test_run_all, test_list, test_reset, test_log
// ============================================================================

import { z } from 'zod';
import * as mp from '../lib/multipass.js';
import { resolveTestChain, getTests, E2E_DEPS } from '../lib/deps.js';
import {
  createRun,
  writeTestResult,
  writeTestLog,
  writeSummary,
  extractErrors,
  buildCompactSummary,
  readTestLog,
  listRuns,
} from '../lib/logs.js';
import { loadState, recordRun } from '../lib/state.js';
import { VM_HOST, SERVER_PORT } from '../config.js';

/**
 * Run a single test script on the host VM and capture results.
 * Tests run on the host VM where shell-server is running, with the API key
 * and server URL set via environment variables.
 */
async function runTestOnVm(testFile, apiKey) {
  const startMs = Date.now();

  const result = await mp.exec(
    VM_HOST,
    `API_KEY=${apiKey} BASE_URL=https://127.0.0.1:${SERVER_PORT} bash /tmp/e2e/${testFile}`,
    { sudo: false, timeout: 120_000, allowFailure: true },
  );

  const output = result.stdout + '\n' + result.stderr;
  return {
    status: result.exitCode === 0 ? 'passed' : 'failed',
    durationMs: Date.now() - startMs,
    output,
    errors: result.exitCode !== 0 ? extractErrors(output) : [],
  };
}

/** Finalize a test run: write summary, record in state, return MCP response. */
function finishRun(run, target, testResults, startMs) {
  const summary = {
    runId: run.id,
    target,
    passed: testResults.filter((t) => t.status === 'passed').length,
    failed: testResults.filter((t) => t.status === 'failed').length,
    skipped: testResults.filter((t) => t.status === 'skipped').length,
    durationMs: Date.now() - startMs,
    tests: testResults,
  };

  writeSummary(run.runDir, summary);
  recordRun({ id: run.id, target, timestamp: new Date().toISOString() });

  return {
    content: [{ type: 'text', text: buildCompactSummary(summary) }],
  };
}

export const testRunTool = {
  name: 'test_run',
  description:
    'Run a specific test by number on the host VM, automatically resolving its ' +
    'dependencies. Returns a compact summary with pass/fail and error lines only. ' +
    'Use test_log to fetch full output for a specific test if needed.',
  inputSchema: z.object({
    test: z.coerce
      .number()
      .int()
      .min(1)
      .describe('Test number to run (e.g. 1 for standalone-install)'),
    skipDeps: z.coerce
      .boolean()
      .default(false)
      .describe(
        'Skip dependency tests (use if you know prerequisites are met, e.g. from a snapshot)',
      ),
  }),
  async handler({ test, skipDeps } = {}) {
    skipDeps = skipDeps ?? false;
    const state = loadState();

    if (!state.credentials?.apiKey) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: 'No credentials found. Provision host first.',
            }),
          },
        ],
      };
    }

    // Resolve test chain
    const chain = resolveTestChain(test);
    const testsToRun = skipDeps ? chain.filter((t) => t.number === test) : chain;

    if (testsToRun.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: `Test ${test} not found. Use test_list to see available tests.`,
            }),
          },
        ],
      };
    }

    const run = createRun();
    const startMs = Date.now();
    const testResults = [];

    for (const { number, file } of testsToRun) {
      const testName = file.replace('.sh', '');
      const result = await runTestOnVm(file, state.credentials.apiKey);

      const testEntry = {
        number,
        name: testName,
        status: result.status,
        durationMs: result.durationMs,
        errors: result.errors,
      };

      testResults.push(testEntry);
      writeTestResult(run.testsDir, testName, testEntry);
      writeTestLog(run.logsDir, testName, result.output);

      // Stop on failure
      if (result.status === 'failed') break;
    }

    return finishRun(run, test, testResults, startMs);
  },
};

export const testRunAllTool = {
  name: 'test_run_all',
  description:
    'Run all E2E tests on the host VM in order. Returns a compact summary — ' +
    'errors only for failed tests.',
  inputSchema: z.object({}),
  async handler() {
    const state = loadState();

    if (!state.credentials?.apiKey) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: 'No credentials found. Provision host first.',
            }),
          },
        ],
      };
    }

    const run = createRun();
    const startMs = Date.now();
    const allResults = [];

    const tests = getTests();
    const sorted = Object.entries(tests).sort(([a], [b]) => Number(a) - Number(b));

    for (const [num, file] of sorted) {
      const testName = file.replace('.sh', '');
      const result = await runTestOnVm(file, state.credentials.apiKey);

      const entry = {
        number: Number(num),
        name: testName,
        status: result.status,
        durationMs: result.durationMs,
        errors: result.errors,
      };

      allResults.push(entry);
      writeTestResult(run.testsDir, testName, entry);
      writeTestLog(run.logsDir, testName, result.output);
    }

    return finishRun(run, 'all', allResults, startMs);
  },
};

export const testListTool = {
  name: 'test_list',
  description:
    'List all available E2E tests with their dependency graph and filenames.',
  inputSchema: z.object({}),
  async handler() {
    const tests = getTests();
    const result = Object.entries(tests)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([num, file]) => ({
        number: Number(num),
        file,
        deps: E2E_DEPS[Number(num)] || [],
      }));

    return {
      content: [
        { type: 'text', text: JSON.stringify({ tests: result }, null, 2) },
      ],
    };
  },
};

export const testResetTool = {
  name: 'test_reset',
  description:
    'Reset test state on VMs: kill stray tmux sessions on agent, restart services. ' +
    'Use between test runs if shared state is causing issues.',
  inputSchema: z.object({}),
  async handler() {
    const steps = [];

    // Kill tmux sessions on agent
    await mp.exec(VM_HOST, 'tmux kill-server 2>/dev/null || true', {
      allowFailure: true,
    });
    steps.push('Killed tmux sessions on host');

    // Restart shell-server
    await mp.exec(VM_HOST, 'sudo systemctl restart shell-server', {
      allowFailure: true,
    });
    steps.push('Restarted shell-server');

    // Kill tmux on agent VM and restart agent
    const agentVm = 'shell-agent';
    await mp.exec(agentVm, 'tmux kill-server 2>/dev/null || true', {
      allowFailure: true,
    });
    steps.push('Killed tmux sessions on agent');

    await mp.exec(agentVm, 'sudo systemctl restart shell-agent', {
      allowFailure: true,
    });
    steps.push('Restarted shell-agent');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, steps }, null, 2),
        },
      ],
    };
  },
};

export const testLogTool = {
  name: 'test_log',
  description:
    'Fetch the full raw log output for a specific test from an intermediate run. ' +
    'Use this after test_run shows a failure and you need the complete output to debug.',
  inputSchema: z.object({
    testName: z
      .string()
      .describe(
        'Test name (e.g. "01-standalone-install-standalone-install")',
      ),
    runId: z
      .string()
      .optional()
      .describe('Run ID (default: most recent run)'),
  }),
  async handler({ testName, runId } = {}) {
    const targetRunId = runId || listRuns()[0];
    if (!targetRunId) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: false, error: 'No test runs found' }),
          },
        ],
      };
    }

    const log = readTestLog(targetRunId, testName);
    if (!log) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: `No log found for test "${testName}" in run "${targetRunId}"`,
              availableRuns: listRuns().slice(0, 5),
            }),
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: log }],
    };
  },
};
