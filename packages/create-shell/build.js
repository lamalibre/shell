import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/cli.js',
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
