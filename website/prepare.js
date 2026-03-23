#!/usr/bin/env node

/**
 * Prepares the VitePress source directory:
 * 1. Copies markdown docs from docs/ into website/src/
 * 2. Generates the sidebar config from _index.json
 * 3. Writes the landing page (index.md)
 *
 * Run before `vitepress build` or `vitepress dev`.
 */

import {
  readFileSync,
  writeFileSync,
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsSource = resolve(__dirname, '..', 'docs');
const srcDir = resolve(__dirname, 'src');

// 1. Clean and copy docs into src/
rmSync(srcDir, { recursive: true, force: true });
mkdirSync(srcDir, { recursive: true });
cpSync(docsSource, srcDir, { recursive: true });

// Remove _index.json and README.md from the copy (not pages)
rmSync(resolve(srcDir, '_index.json'), { force: true });
rmSync(resolve(srcDir, 'README.md'), { force: true });

console.log('Copied docs into website/src/');

// 2. Generate sidebar from _index.json
const index = JSON.parse(readFileSync(resolve(docsSource, '_index.json'), 'utf-8'));

const sidebar = index.sections.map((section) => ({
  text: section.title,
  items: section.pages.map((page) => ({
    text: page.title,
    link: `/${page.file.replace(/\.md$/, '')}`,
  })),
}));

// 3. Copy E2E test results if available
const e2eSource = resolve(__dirname, '..', 'e2e-logs');
const e2eDest = resolve(srcDir, 'e2e-results');

const e2eSidebarSections = [];

if (existsSync(e2eSource)) {
  mkdirSync(e2eDest, { recursive: true });
  cpSync(e2eSource, e2eDest, { recursive: true });
  console.log('Copied E2E test results');

  // Add E2E sidebar section for any .md files found
  const { readdirSync } = await import('node:fs');
  const e2eFiles = readdirSync(e2eSource).filter((f) => f.endsWith('.md')).sort();
  if (e2eFiles.length > 0) {
    e2eSidebarSections.push({
      text: 'E2E Results',
      items: e2eFiles.map((f) => ({
        text: f.replace(/\.md$/, '').replace(/[-_]/g, ' '),
        link: `/e2e-results/${f.replace(/\.md$/, '')}`,
      })),
    });
  }
} else {
  console.warn('e2e-logs/ not found — skipping E2E results');
}

// Write sidebar
const fullSidebar = [...sidebar, ...e2eSidebarSections];
const sidebarPath = resolve(__dirname, '.vitepress', 'sidebar.json');
writeFileSync(sidebarPath, JSON.stringify(fullSidebar, null, 2) + '\n');
console.log(`Wrote ${fullSidebar.length} sidebar sections`);

// 4. Write landing page
const landingPage = `---
layout: home

hero:
  name: Shell
  text: Secure remote terminal via tmux
  tagline: Access remote machines through a WebSocket relay. No SSH. mTLS everywhere. Session recording by default.
  actions:
    - theme: brand
      text: Get Started
      link: /00-introduction/what-is-shell
    - theme: alt
      text: Quick Start
      link: /00-introduction/quickstart
    - theme: alt
      text: API Reference
      link: /04-api-reference/overview

features:
  - title: No SSH Required
    details: Terminal access via tmux and WebSocket relay. Works through firewalls, NATs, and reverse tunnels without opening ports.
  - title: 5-Gate Security
    details: Admin role, global toggle, agent cert validation, time-window enforcement, and IP ACL. Every session recorded automatically.
  - title: Standalone or Plugin
    details: Run independently with its own CA and auth, or integrate into Portlama for shared mTLS, registry, and panel pages.
  - title: Desktop, CLI & API
    details: Tauri desktop app, interactive CLI, and full REST API. Manage agents, policies, sessions, and recordings from anywhere.
---
`;

writeFileSync(resolve(srcDir, 'index.md'), landingPage);
console.log('Wrote landing page');
