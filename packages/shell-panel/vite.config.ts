import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        css: 'injected',
      },
    }),
    tailwindcss(),
  ],
  build: {
    outDir: 'dist',
    lib: {
      entry: 'src/panel.ts',
      formats: ['iife'],
      name: '_shellPanel',
      fileName: () => 'panel.js',
    },
    cssCodeSplit: false,
    minify: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
