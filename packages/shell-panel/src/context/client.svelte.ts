import { getContext, setContext } from 'svelte';
import type { ShellClient } from '../lib/client.js';

const CLIENT_KEY = Symbol('shell-client');

/**
 * Set the ShellClient in Svelte context.
 * Must be called during component initialization (in a parent component).
 */
export function setShellClient(client: ShellClient): void {
  setContext(CLIENT_KEY, client);
}

/**
 * Get the ShellClient from Svelte context.
 * Must be called during component initialization.
 */
export function getShellClient(): ShellClient {
  return getContext<ShellClient>(CLIENT_KEY);
}
