<script lang="ts">
  import { getShellClient } from '../context/client.svelte.js';
  import { formatTimeRemaining } from '../lib/format.js';
  import type { ShellAgent, ShellPolicy } from '../lib/types.js';
  import Modal from '../components/Modal.svelte';
  import ConfirmModal from '../components/ConfirmModal.svelte';
  import DesktopActionModal from '../components/DesktopActionModal.svelte';

  interface Props {
    mode?: 'desktop' | 'panel' | undefined;
    onconnect?: ((label: string) => void) | undefined;
  }

  let { mode = 'panel', onconnect }: Props = $props();

  const client = getShellClient();

  let agents = $state<ShellAgent[]>([]);
  let policies = $state<ShellPolicy[]>([]);
  let error = $state('');
  let loading = $state(true);

  // Search & filter
  let searchQuery = $state('');
  let statusFilter = $state<'all' | 'enabled' | 'disabled' | 'revoked'>('all');

  // Enable modal state
  let showEnableModal = $state(false);
  let enableTarget = $state('');
  let enableDuration = $state(15);
  let enablePolicy = $state('');
  let enableLoading = $state(false);

  // Bulk selection
  let selectedLabels = $state<Set<string>>(new Set());
  let bulkLoading = $state(false);
  let bulkProgress = $state('');

  // Join token modal
  let showCreateTokenModal = $state(false);
  let tokenLabel = $state('');
  let showTokenModal = $state(false);
  let joinToken = $state('');
  let tokenLoading = $state(false);
  let tokenCopied = $state(false);

  // Desktop action modal (for panel mode)
  let showDesktopActionModal = $state(false);
  let desktopActionTitle = $state('');
  let desktopActionCommand = $state('');

  // Revoke confirmation modal
  let showRevokeModal = $state(false);
  let revokeTarget = $state('');
  let revokeLoading = $state(false);

  const durations = [
    { label: '5 minutes', value: 5 },
    { label: '10 minutes', value: 10 },
    { label: '15 minutes', value: 15 },
    { label: '30 minutes', value: 30 },
    { label: '1 hour', value: 60 },
    { label: '2 hours', value: 120 },
    { label: '4 hours', value: 240 },
    { label: '8 hours', value: 480 },
  ];

  async function loadData() {
    try {
      const [agentRes, policyRes] = await Promise.all([client.getAgents(), client.getPolicies()]);
      agents = agentRes.agents;
      policies = policyRes.policies;
      error = '';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadData();
    const interval = setInterval(loadData, 15_000);
    return () => clearInterval(interval);
  });

  function isEnabled(agent: ShellAgent): boolean {
    if (!agent.shellEnabledUntil) return false;
    return new Date(agent.shellEnabledUntil).getTime() > Date.now();
  }

  function agentStatus(agent: ShellAgent): 'enabled' | 'disabled' | 'revoked' {
    if (agent.revoked) return 'revoked';
    return isEnabled(agent) ? 'enabled' : 'disabled';
  }

  let filteredAgents = $derived(
    agents.filter((agent) => {
      const matchesSearch =
        searchQuery === '' ||
        agent.label.toLowerCase().includes(searchQuery.toLowerCase());
      const status = agentStatus(agent);
      const matchesFilter = statusFilter === 'all' || status === statusFilter;
      return matchesSearch && matchesFilter;
    }),
  );

  let allSelected = $derived(
    filteredAgents.length > 0 && filteredAgents.every((a) => selectedLabels.has(a.label)),
  );

  let someSelected = $derived(selectedLabels.size > 0);

  function toggleSelectAll() {
    if (allSelected) {
      selectedLabels = new Set();
    } else {
      selectedLabels = new Set(filteredAgents.map((a) => a.label));
    }
  }

  function toggleSelect(label: string) {
    const next = new Set(selectedLabels);
    if (next.has(label)) {
      next.delete(label);
    } else {
      next.add(label);
    }
    selectedLabels = next;
  }

  function openEnableModal(label: string) {
    enableTarget = label;
    enableDuration = 15;
    enablePolicy = '';
    showEnableModal = true;
  }

  function openBulkEnable() {
    enableTarget = '';
    enableDuration = 15;
    enablePolicy = '';
    showEnableModal = true;
  }

  async function handleEnable() {
    enableLoading = true;
    try {
      if (enableTarget) {
        await client.enableAgentShell(enableTarget, enableDuration, enablePolicy || undefined);
      } else {
        bulkLoading = true;
        const labels = [...selectedLabels];
        for (let i = 0; i < labels.length; i++) {
          const label = labels[i]!;
          bulkProgress = `Enabling ${i + 1}/${labels.length}: ${label}`;
          await client.enableAgentShell(label, enableDuration, enablePolicy || undefined);
        }
        bulkProgress = '';
        bulkLoading = false;
        selectedLabels = new Set();
      }
      showEnableModal = false;
      await loadData();
    } catch (e) {
      error = String(e);
    } finally {
      enableLoading = false;
      bulkLoading = false;
      bulkProgress = '';
    }
  }

  async function handleDisable(label: string) {
    try {
      await client.disableAgentShell(label);
      await loadData();
    } catch (e) {
      error = String(e);
    }
  }

  async function handleBulkDisable() {
    bulkLoading = true;
    try {
      const labels = [...selectedLabels];
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i]!;
        bulkProgress = `Disabling ${i + 1}/${labels.length}: ${label}`;
        await client.disableAgentShell(label);
      }
      selectedLabels = new Set();
      await loadData();
    } catch (e) {
      error = String(e);
    } finally {
      bulkLoading = false;
      bulkProgress = '';
    }
  }

  function handleConnect(label: string) {
    if (mode === 'desktop' && onconnect) {
      onconnect(label);
    } else {
      desktopActionTitle = 'Connect to Agent';
      desktopActionCommand = `shell-cli connect ${label}`;
      showDesktopActionModal = true;
    }
  }

  function openCreateTokenModal() {
    tokenLabel = '';
    showCreateTokenModal = true;
  }

  async function handleCreateJoinToken() {
    if (!tokenLabel) {
      error = 'Agent label is required';
      return;
    }
    tokenLoading = true;
    tokenCopied = false;
    try {
      const res = await client.createJoinToken(tokenLabel);
      joinToken = res.token;
      showCreateTokenModal = false;
      showTokenModal = true;
      error = '';
    } catch (e) {
      error = String(e);
    } finally {
      tokenLoading = false;
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(joinToken);
      tokenCopied = true;
    } catch {
      const input = document.getElementById('join-token-display') as HTMLInputElement | null;
      if (input) {
        input.select();
      }
    }
  }

  function openRevokeModal(label: string) {
    revokeTarget = label;
    showRevokeModal = true;
  }

  async function handleRevoke() {
    revokeLoading = true;
    try {
      await client.revokeAgent(revokeTarget);
      showRevokeModal = false;
      await loadData();
    } catch (e) {
      error = String(e);
    } finally {
      revokeLoading = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold text-text-primary">Agents</h1>
    <div class="flex items-center gap-2">
      <button
        class="rounded-lg bg-accent/20 px-3 py-1.5 text-sm text-accent hover:bg-accent/30"
        onclick={openCreateTokenModal}
      >
        Create Join Token
      </button>
      <button
        class="rounded-lg bg-card-hover px-3 py-1.5 text-sm text-text-primary hover:bg-border"
        onclick={loadData}
      >
        Refresh
      </button>
    </div>
  </div>

  <!-- Search & Filter -->
  <div class="flex items-center gap-3">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search agents..."
      class="flex-1 rounded border border-border bg-card px-3 py-1.5 text-sm text-text-primary placeholder-text-secondary"
    />
    <select
      bind:value={statusFilter}
      class="rounded border border-border bg-card px-3 py-1.5 text-sm text-text-primary"
    >
      <option value="all">All</option>
      <option value="enabled">Enabled</option>
      <option value="disabled">Disabled</option>
      <option value="revoked">Revoked</option>
    </select>
  </div>

  <!-- Bulk actions -->
  {#if someSelected}
    <div class="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2">
      <span class="text-sm text-text-secondary">{selectedLabels.size} selected</span>
      {#if bulkProgress}
        <span class="text-sm text-warning">{bulkProgress}</span>
      {:else}
        <button
          class="rounded-lg bg-emerald-900/50 px-3 py-1 text-sm text-emerald-300 hover:bg-emerald-900 disabled:opacity-50"
          onclick={openBulkEnable}
          disabled={bulkLoading}
        >
          Bulk Enable
        </button>
        <button
          class="rounded-lg bg-red-900/50 px-3 py-1 text-sm text-red-300 hover:bg-red-900 disabled:opacity-50"
          onclick={handleBulkDisable}
          disabled={bulkLoading}
        >
          Bulk Disable
        </button>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="py-12 text-center text-text-secondary">Loading agents...</div>
  {:else if agents.length === 0}
    <div class="py-12 text-center text-text-secondary">
      No agents registered. Use <code class="rounded bg-card px-1.5 py-0.5">shell enroll</code> to add one.
    </div>
  {:else if filteredAgents.length === 0}
    <div class="py-12 text-center text-text-secondary">No agents match the current filter.</div>
  {:else}
    <!-- Select All -->
    <div class="flex items-center gap-2 px-1">
      <input
        type="checkbox"
        checked={allSelected}
        onchange={toggleSelectAll}
        class="h-4 w-4 rounded border-border bg-card text-accent"
      />
      <span class="text-xs text-text-secondary">Select All</span>
    </div>

    <div class="grid gap-3">
      {#each filteredAgents as agent}
        {@const enabled = isEnabled(agent)}
        <div class="rounded-xl border border-border bg-card p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedLabels.has(agent.label)}
                onchange={() => toggleSelect(agent.label)}
                class="h-4 w-4 rounded border-border bg-surface text-accent"
              />
              <div class="h-2.5 w-2.5 rounded-full {enabled ? 'bg-success' : agent.revoked ? 'bg-error' : 'bg-border'}"></div>
              <span class="font-mono text-sm font-medium text-text-primary">{agent.label}</span>
              {#if agent.revoked}
                <span class="rounded bg-red-900/50 px-2 py-0.5 text-xs text-red-300">Revoked</span>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              {#if enabled}
                <span class="text-xs text-success">
                  {formatTimeRemaining(agent.shellEnabledUntil)} remaining
                </span>
                <button
                  class="rounded-lg bg-card-hover px-3 py-1.5 text-sm text-text-primary hover:bg-border"
                  onclick={() => handleConnect(agent.label)}
                >
                  Connect
                </button>
                <button
                  class="rounded-lg bg-red-900/50 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900"
                  onclick={() => handleDisable(agent.label)}
                >
                  Disable
                </button>
              {:else if !agent.revoked}
                <button
                  class="rounded-lg bg-emerald-900/50 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900"
                  onclick={() => openEnableModal(agent.label)}
                >
                  Enable
                </button>
              {/if}
              {#if !agent.revoked}
                <button
                  class="rounded-lg bg-red-900/50 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900"
                  onclick={() => openRevokeModal(agent.label)}
                >
                  Revoke
                </button>
              {/if}
            </div>
          </div>
          {#if agent.shellPolicy}
            <div class="mt-2 text-xs text-text-secondary">
              Policy: <span class="text-text-primary">{agent.shellPolicy}</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if showEnableModal}
  <Modal title={enableTarget ? 'Enable Shell Access' : 'Bulk Enable Shell Access'} onclose={() => (showEnableModal = false)}>
    <form class="space-y-4" onsubmit={(e) => { e.preventDefault(); handleEnable(); }}>
      {#if enableTarget}
        <div>
          <label class="mb-1 block text-sm text-text-secondary" for="enable-agent">Agent</label>
          <input
            id="enable-agent"
            type="text"
            readonly
            value={enableTarget}
            class="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text-primary"
          />
        </div>
      {:else}
        <div class="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-primary">
          Enabling {selectedLabels.size} agents: {[...selectedLabels].join(', ')}
        </div>
      {/if}
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="enable-duration">Duration</label>
        <select
          id="enable-duration"
          bind:value={enableDuration}
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        >
          {#each durations as d}
            <option value={d.value}>{d.label}</option>
          {/each}
        </select>
      </div>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="enable-policy">Policy (optional)</label>
        <select
          id="enable-policy"
          bind:value={enablePolicy}
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        >
          <option value="">Default</option>
          {#each policies as p}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </div>
      <div class="flex justify-end gap-3 pt-2">
        <button
          type="button"
          class="rounded-lg bg-card-hover px-4 py-2 text-sm text-text-primary hover:bg-border"
          onclick={() => (showEnableModal = false)}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={enableLoading}
          class="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {enableLoading ? 'Enabling...' : 'Enable'}
        </button>
      </div>
    </form>
  </Modal>
{/if}

{#if showCreateTokenModal}
  <Modal title="Create Join Token" onclose={() => (showCreateTokenModal = false)}>
    <form class="space-y-4" onsubmit={(e) => { e.preventDefault(); handleCreateJoinToken(); }}>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="token-label">Agent Label</label>
        <input
          id="token-label"
          type="text"
          bind:value={tokenLabel}
          required
          pattern="[a-z0-9\-]+"
          placeholder="my-agent"
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text-primary"
        />
        <p class="mt-1 text-xs text-text-secondary">Lowercase letters, digits, and hyphens only.</p>
      </div>
      <div class="flex justify-end gap-3 pt-2">
        <button
          type="button"
          class="rounded-lg bg-card-hover px-4 py-2 text-sm text-text-primary hover:bg-border"
          onclick={() => (showCreateTokenModal = false)}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={tokenLoading}
          class="rounded-lg bg-accent px-4 py-2 text-sm text-surface hover:bg-accent-dim disabled:opacity-50"
        >
          {tokenLoading ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  </Modal>
{/if}

{#if showTokenModal}
  <Modal title="Join Token Created" onclose={() => (showTokenModal = false)}>
    <div class="space-y-4">
      <p class="text-sm text-text-secondary">
        Use this token to enroll a new agent. The token is single-use.
      </p>
      <div class="flex items-center gap-2">
        <input
          id="join-token-display"
          type="text"
          readonly
          value={joinToken}
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text-primary"
        />
        <button
          class="shrink-0 rounded-lg bg-accent/20 px-3 py-2 text-sm text-accent hover:bg-accent/30"
          onclick={copyToken}
        >
          {tokenCopied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div class="rounded-lg border border-border bg-surface px-4 py-3">
        <p class="text-xs text-text-secondary">Usage:</p>
        <code class="mt-1 block text-xs text-text-primary">
          shell-agent enroll --server &lt;url&gt; --token {joinToken}
        </code>
      </div>
      <div class="flex justify-end pt-2">
        <button
          class="rounded-lg bg-card-hover px-4 py-2 text-sm text-text-primary hover:bg-border"
          onclick={() => (showTokenModal = false)}
        >
          Close
        </button>
      </div>
    </div>
  </Modal>
{/if}

{#if showRevokeModal}
  <ConfirmModal
    title="Revoke Agent"
    confirmLabel={revokeLoading ? 'Revoking...' : 'Revoke'}
    loading={revokeLoading}
    onconfirm={handleRevoke}
    onclose={() => (showRevokeModal = false)}
  >
    Are you sure you want to revoke agent <strong class="font-mono">{revokeTarget}</strong>?
    This will permanently invalidate the agent's certificate. This cannot be undone.
  </ConfirmModal>
{/if}

{#if showDesktopActionModal}
  <DesktopActionModal
    title={desktopActionTitle}
    command={desktopActionCommand}
    onclose={() => (showDesktopActionModal = false)}
  />
{/if}
