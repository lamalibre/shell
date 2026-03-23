// ============================================================================
// Test Discovery & Dependency Graph
// ============================================================================
// Discovers test files from the filesystem and verifies they are git-tracked.
// Only files matching the NN-name.sh convention that are committed to git are
// eligible for execution — this prevents injected scripts from being run.

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { E2E_DIR, REPO_ROOT } from '../config.js';

/** Pattern for valid test files: two-digit prefix, hyphen, name, .sh extension. */
const TEST_FILE_PATTERN = /^(\d{2})-[a-z0-9-]+\.sh$/;

/**
 * Get the set of git-tracked files in a directory (relative to repo root).
 * Returns a Set of filenames (not full paths).
 */
function getGitTrackedFiles(dir) {
  try {
    const relativePath = dir.replace(REPO_ROOT + '/', '');
    const output = execSync(`git ls-files "${relativePath}"`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return new Set(
      output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((f) => f.split('/').pop()),
    );
  } catch {
    return new Set();
  }
}

/**
 * Discover test files from the E2E directory.
 * Only returns files that:
 *   1. Match the NN-name.sh naming convention
 *   2. Are tracked by git (not injected/untracked)
 * Returns a map of { number: filename }.
 */
export function discoverTests() {
  const gitTracked = getGitTrackedFiles(E2E_DIR);
  const files = fs.readdirSync(E2E_DIR).filter((f) => TEST_FILE_PATTERN.test(f));
  const map = {};

  for (const file of files) {
    if (!gitTracked.has(file)) continue;
    const num = parseInt(file.slice(0, 2), 10);
    map[num] = file;
  }

  return map;
}

/**
 * Shell E2E test dependency graph.
 * Key = test number, Value = array of prerequisite test numbers.
 *
 * Test 01 verifies fresh install (server start, CA, health).
 * Most tests require the server to be running, so they depend on 01.
 * Test 02 (auth chain) depends on 01.
 * Tests 03-09 depend on 01 (server running).
 */
export const E2E_DEPS = {
  1: [], // standalone-install — no deps
  2: [1], // auth-chain
  3: [1], // session-lifecycle
  4: [1], // command-blocklist
  5: [1], // session-recording
  6: [1], // policy-crud
  7: [1], // concurrent-sessions
  8: [1], // time-window
  9: [1], // plugin-mode
};

/** Lazily discovered test map — cached after first call. */
let _tests = null;

/** Get the test file map. Auto-discovered and cached. */
export function getTests() {
  if (!_tests) _tests = discoverTests();
  return _tests;
}

/** Invalidate cached test map. */
export function clearTestCache() {
  _tests = null;
}

/**
 * Resolve the full dependency chain for a given test number.
 * Returns a sorted array of test numbers that must run (including the target).
 */
export function resolveDeps(testNumber) {
  const visited = new Set();
  const order = [];

  function walk(n) {
    if (visited.has(n)) return;
    visited.add(n);
    const deps = E2E_DEPS[n] || [];
    for (const dep of deps) {
      walk(dep);
    }
    order.push(n);
  }

  walk(testNumber);
  return order.sort((a, b) => a - b);
}

/**
 * Given a target test number, return the minimal set of test filenames to run.
 */
export function resolveTestChain(testNumber) {
  const testMap = getTests();
  const chain = resolveDeps(testNumber);
  return chain
    .map((n) => ({ number: n, file: testMap[n] }))
    .filter((t) => t.file);
}
