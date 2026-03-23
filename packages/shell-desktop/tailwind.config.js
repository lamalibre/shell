/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{svelte,ts}', './index.html'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
