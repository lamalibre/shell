import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageDir = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf-8'));

// Build panel microfrontend bundle if the package has one
const panelEntry = resolve(packageDir, 'src/panel.ts');
if (existsSync(panelEntry)) {
  await build({
    entryPoints: [panelEntry],
    outfile: resolve(packageDir, 'dist/panel.js'),
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    minify: true,
    sourcemap: false,
  });
  console.log(`Built ${pkg.name} → dist/panel.js`);
}
