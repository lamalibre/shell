<script lang="ts">
  import { getShellClient } from '../context/client.svelte.js';
  import type { ShellPolicy } from '../lib/types.js';

  const client = getShellClient();

  let enabled = $state(false);
  let defaultPolicy = $state('');
  let policies = $state<ShellPolicy[]>([]);
  let loading = $state(true);
  let toggleLoading = $state(false);
  let error = $state('');
  let success = $state('');

  async function loadConfig() {
    try {
      const config = await client.getServerConfig();
      enabled = config.enabled;
      defaultPolicy = config.defaultPolicy;
      policies = config.policies;
      error = '';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadConfig();
  });

  async function toggleEnabled() {
    toggleLoading = true;
    success = '';
    error = '';
    try {
      const config = await client.updateServerConfig({ enabled: !enabled });
      enabled = config.enabled;
      success = enabled ? 'Shell access enabled.' : 'Shell access disabled.';
    } catch (e) {
      error = String(e);
    } finally {
      toggleLoading = false;
    }
  }

  async function changeDefaultPolicy(e: Event) {
    const target = e.target as HTMLSelectElement;
    success = '';
    error = '';
    try {
      const config = await client.updateServerConfig({ defaultPolicy: target.value });
      defaultPolicy = config.defaultPolicy;
      success = 'Default policy updated.';
    } catch (err) {
      error = String(err);
    }
  }
</script>

<div class="space-y-6">
  <h1 class="text-xl font-bold text-text-primary">Settings</h1>

  {#if error}
    <div class="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  {/if}
  {#if success}
    <div class="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-300">
      {success}
    </div>
  {/if}

  {#if loading}
    <div class="py-12 text-center text-text-secondary">Loading configuration...</div>
  {:else}
    <!-- Shell Access Toggle -->
    <div class="rounded-xl border border-border bg-card p-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="font-medium text-text-primary">Shell Access</h2>
          <p class="mt-1 text-sm text-text-secondary">
            Global toggle for shell access across all agents.
          </p>
        </div>
        <button
          aria-label="Toggle shell access"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors
            {enabled ? 'bg-emerald-600' : 'bg-border'}
            {toggleLoading ? 'opacity-50' : ''}"
          onclick={toggleEnabled}
          disabled={toggleLoading}
        >
          <span
            class="inline-block h-4 w-4 rounded-full bg-white transition-transform
              {enabled ? 'translate-x-6' : 'translate-x-1'}"
          ></span>
        </button>
      </div>
      <div class="mt-2 text-sm {enabled ? 'text-emerald-400' : 'text-text-secondary'}">
        {enabled ? 'Enabled' : 'Disabled'}
      </div>
    </div>

    <!-- Default Policy -->
    <div class="rounded-xl border border-border bg-card p-6">
      <h2 class="font-medium text-text-primary">Default Policy</h2>
      <p class="mt-1 text-sm text-text-secondary">
        Policy applied when enabling shell access without specifying one.
      </p>
      <select
        value={defaultPolicy}
        onchange={changeDefaultPolicy}
        class="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
      >
        {#each policies as policy}
          <option value={policy.id}>{policy.name}</option>
        {/each}
      </select>
    </div>

    <!-- Policy Summary -->
    <div class="rounded-xl border border-border bg-card p-6">
      <h2 class="font-medium text-text-primary">Policies</h2>
      <p class="mt-1 text-sm text-text-secondary">
        {policies.length} {policies.length === 1 ? 'policy' : 'policies'} configured.
        Manage policies from the Policies tab.
      </p>
      <div class="mt-3 space-y-2">
        {#each policies as policy}
          <div class="flex items-center justify-between rounded-lg bg-surface px-4 py-2">
            <div class="flex items-center gap-2">
              <span class="text-sm text-text-primary">{policy.name}</span>
              {#if policy.id === defaultPolicy}
                <span class="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent">Default</span>
              {/if}
            </div>
            <span class="text-xs text-text-secondary">{policy.id}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
