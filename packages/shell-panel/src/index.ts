// Pages
export { default as Agents } from './pages/Agents.svelte';
export { default as Policies } from './pages/Policies.svelte';
export { default as Sessions } from './pages/Sessions.svelte';
export { default as Recordings } from './pages/Recordings.svelte';
export { default as Settings } from './pages/Settings.svelte';

// Root app
export { default as ShellApp } from './App.svelte';

// Components
export { default as Modal } from './components/Modal.svelte';
export { default as ConfirmModal } from './components/ConfirmModal.svelte';
export { default as DesktopActionModal } from './components/DesktopActionModal.svelte';

// Context
export { setShellClient, getShellClient } from './context/client.svelte.js';

// Client interface & implementations
export type { ShellClient } from './lib/client.js';
export { createFetchShellClient } from './lib/fetch-client.js';

// Types
export * from './lib/types.js';

// Utilities
export { formatDate, formatDuration, formatTimeRemaining } from './lib/format.js';

// Page metadata
export { SHELL_PAGES } from './lib/pages.js';
