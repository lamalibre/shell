<script lang="ts">
  import { untrack } from 'svelte';
  import type { ShellClient } from './lib/client.js';
  import { setShellClient } from './context/client.svelte.js';
  import Agents from './pages/Agents.svelte';
  import Policies from './pages/Policies.svelte';
  import Sessions from './pages/Sessions.svelte';
  import Recordings from './pages/Recordings.svelte';
  import Settings from './pages/Settings.svelte';

  interface Props {
    client: ShellClient;
    currentPage: string;
    mode?: 'desktop' | 'panel' | undefined;
    onconnect?: ((label: string) => void) | undefined;
  }

  let { client, currentPage, mode = 'panel', onconnect }: Props = $props();

  // Provide the client to all child components via context.
  // setContext must run during init. The client instance doesn't change
  // after mount — untrack silences state_referenced_locally.
  setShellClient(untrack(() => client));
</script>

<div class="font-mono text-text-primary">
  {#if currentPage === 'agents'}
    <Agents {mode} {onconnect} />
  {:else if currentPage === 'policies'}
    <Policies />
  {:else if currentPage === 'sessions'}
    <Sessions />
  {:else if currentPage === 'recordings'}
    <Recordings />
  {:else if currentPage === 'settings'}
    <Settings />
  {:else}
    <Agents {mode} {onconnect} />
  {/if}
</div>
