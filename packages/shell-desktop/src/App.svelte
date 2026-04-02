<script lang="ts">
  import { ShellApp } from '@lamalibre/shell-panel';
  import { checkHealth, getServerConfig, updateServerConfig } from './lib/api.js';
  import { createDesktopShellClient } from './lib/desktop-client.js';
  import { Command } from '@tauri-apps/plugin-shell';
  import DesktopSettings from './views/DesktopSettings.svelte';
  import { Users, Shield, Terminal, Video, Settings } from 'lucide-svelte';

  type Tab = 'agents' | 'policies' | 'sessions' | 'recordings' | 'settings';

  let activeTab = $state<Tab>('agents');
  let serverOnline = $state(false);
  let globalEnabled = $state(false);
  let healthLoading = $state(true);
  let toggleLoading = $state(false);
  let showDesktopSettings = $state(false);

  const client = createDesktopShellClient();

  async function checkServerHealth() {
    try {
      await checkHealth();
      serverOnline = true;
      const config = await getServerConfig();
      globalEnabled = config.enabled;
    } catch {
      serverOnline = false;
    } finally {
      healthLoading = false;
    }
  }

  $effect(() => {
    checkServerHealth();
    const interval = setInterval(checkServerHealth, 30_000);
    return () => clearInterval(interval);
  });

  async function toggleGlobal() {
    toggleLoading = true;
    try {
      const config = await updateServerConfig({ enabled: !globalEnabled });
      globalEnabled = config.enabled;
    } catch {
      // Error will show in server health
    } finally {
      toggleLoading = false;
    }
  }

  async function handleConnect(label: string) {
    try {
      const cmd = Command.create('shell-cli', ['connect', label]);
      await cmd.spawn();
    } catch (e) {
      console.error(`Failed to launch shell connect: ${String(e)}`);
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'agents', label: 'Agents', icon: Users },
    { id: 'policies', label: 'Policies', icon: Shield },
    { id: 'sessions', label: 'Sessions', icon: Terminal },
    { id: 'recordings', label: 'Recordings', icon: Video },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];
</script>

<div class="flex h-screen font-mono">
  <!-- Sidebar -->
  <aside class="flex w-56 flex-col border-r border-border bg-surface">
    <div class="border-b border-border px-4 py-4">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-bold text-text-primary">Shell</h1>
        <button
          aria-label="Desktop Settings"
          class="rounded p-1 text-text-secondary hover:bg-card-hover hover:text-text-primary"
          onclick={() => (showDesktopSettings = true)}
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </div>
      <div class="mt-1 flex items-center gap-2 text-xs">
        {#if healthLoading}
          <span class="text-text-secondary">Checking...</span>
        {:else if serverOnline}
          <span class="h-2 w-2 rounded-full bg-success"></span>
          <span class="text-success">Server Online</span>
        {:else}
          <span class="h-2 w-2 rounded-full bg-error"></span>
          <span class="text-error">Server Offline</span>
        {/if}
      </div>
    </div>

    <nav class="flex-1 px-2 py-3">
      {#each tabs as tab}
        <button
          class="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors
            {activeTab === tab.id
              ? 'bg-card text-text-primary'
              : 'text-text-secondary hover:bg-card-hover hover:text-text-primary'}"
          onclick={() => (activeTab = tab.id)}
        >
          <tab.icon class="h-4 w-4" />
          {tab.label}
        </button>
      {/each}
    </nav>

    <!-- Global toggle -->
    {#if serverOnline}
      <div class="border-t border-border px-4 py-4">
        <div class="flex items-center justify-between">
          <span class="text-xs text-text-secondary">Shell Access</span>
          <button
            aria-label="Toggle shell access"
            class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors
              {globalEnabled ? 'bg-emerald-600' : 'bg-border'}
              {toggleLoading ? 'opacity-50' : ''}"
            onclick={toggleGlobal}
            disabled={toggleLoading}
          >
            <span
              class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform
                {globalEnabled ? 'translate-x-4' : 'translate-x-0.5'}"
            ></span>
          </button>
        </div>
        <span class="mt-1 block text-xs {globalEnabled ? 'text-success' : 'text-text-secondary'}">
          {globalEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
    {/if}
  </aside>

  <!-- Main content -->
  <main class="flex-1 overflow-y-auto p-6">
    {#if !serverOnline && !healthLoading}
      <div class="flex h-full items-center justify-center">
        <div class="text-center">
          <div class="text-4xl text-border">!</div>
          <h2 class="mt-2 text-lg font-semibold text-text-secondary">Server Offline</h2>
          <p class="mt-1 text-sm text-text-secondary">
            Cannot connect to the shell server. Make sure it is running.
          </p>
        </div>
      </div>
    {:else}
      <ShellApp {client} currentPage={activeTab} mode="desktop" onconnect={handleConnect} />
    {/if}
  </main>
</div>

{#if showDesktopSettings}
  <DesktopSettings onclose={() => (showDesktopSettings = false)} />
{/if}
