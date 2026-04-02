/**
 * Shell plugin microfrontend — Svelte 5 panel for the Portlama desktop app.
 *
 * Contract:
 * - Evaluated via `new Function()` in the desktop app
 * - Registers `window.__portlamaPlugins.shell = { pages, mount(ctx) }`
 * - ctx: { mountPoint, panelUrl, basePath, subPath, theme }
 * - Returns `{ unmount() }` for cleanup
 */

import './panel.css';
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import { createFetchShellClient } from './lib/fetch-client.js';
import { SHELL_PAGES } from './lib/pages.js';

interface PanelCtx {
  mountPoint: HTMLElement;
  panelUrl: string;
  basePath: string;
  subPath: string;
  theme?: {
    surface?: string;
    card?: string;
    cardHover?: string;
    border?: string;
    accent?: string;
    accentDim?: string;
    textPrimary?: string;
    textSecondary?: string;
    success?: string;
    warning?: string;
    error?: string;
  };
}

/** Map theme keys to CSS custom property names from @theme. */
const THEME_PROPS: Record<string, string> = {
  surface: '--color-surface',
  card: '--color-card',
  cardHover: '--color-card-hover',
  border: '--color-border',
  accent: '--color-accent',
  accentDim: '--color-accent-dim',
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  success: '--color-success',
  warning: '--color-warning',
  error: '--color-error',
};

const pages = [...SHELL_PAGES];

function mountPanel(ctx: PanelCtx): { unmount: () => void } {
  // Inject CSS if the inline-css post-build script added the helper
  const injectStyles = (window as unknown as Record<string, unknown>).__shellPanelInjectStyles;
  if (typeof injectStyles === 'function') {
    (injectStyles as () => void)();
  }

  // Apply host theme overrides as CSS custom properties on the mount point.
  if (ctx.theme) {
    for (const [key, prop] of Object.entries(THEME_PROPS)) {
      const value = (ctx.theme as Record<string, string | undefined>)[key];
      if (value) {
        ctx.mountPoint.style.setProperty(prop, value);
      }
    }
  }

  const client = createFetchShellClient(ctx.panelUrl, ctx.basePath);

  const app = mount(App, {
    target: ctx.mountPoint,
    props: {
      client,
      currentPage: ctx.subPath || 'agents',
      mode: 'panel' as const,
    },
  });

  return {
    unmount() {
      unmount(app);
      // Remove theme overrides
      if (ctx.theme) {
        for (const prop of Object.values(THEME_PROPS)) {
          ctx.mountPoint.style.removeProperty(prop);
        }
      }
      const removeStyles = (window as unknown as Record<string, unknown>).__shellPanelRemoveStyles;
      if (typeof removeStyles === 'function') {
        (removeStyles as () => void)();
      }
    },
  };
}

// Register on global
(window as unknown as Record<string, unknown>).__portlamaPlugins =
  (window as unknown as Record<string, unknown>).__portlamaPlugins ?? {};
((window as unknown as Record<string, unknown>).__portlamaPlugins as Record<string, unknown>).shell = {
  pages,
  mount: mountPanel,
};
