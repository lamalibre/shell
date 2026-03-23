import { defineConfig } from 'vitepress';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let sidebar;
try {
  sidebar = JSON.parse(readFileSync(resolve(__dirname, 'sidebar.json'), 'utf-8'));
} catch {
  console.warn('sidebar.json not found — run "node prepare.js" first');
  sidebar = [];
}

export default defineConfig({
  title: 'Shell',
  description: 'Secure remote terminal via tmux',

  // GitHub Pages deploys to https://<org>.github.io/shell/
  base: '/shell/',

  srcDir: resolve(__dirname, '..', 'src'),
  outDir: resolve(__dirname, 'dist'),

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/shell/logo.svg' }]],

  themeConfig: {
    siteTitle: 'Shell',

    sidebar,

    nav: [
      { text: 'Guide', link: '/00-introduction/what-is-shell' },
      { text: 'API Reference', link: '/04-api-reference/overview' },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/lamalibre/shell' }],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/lamalibre/shell/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the PolyForm Noncommercial License 1.0.0',
      copyright: 'Copyright 2026 Code Lama Software',
    },

    outline: {
      level: [2, 3],
    },
  },

  ignoreDeadLinks: true,
});
