<script lang="ts">
  import { getShellClient } from '../context/client.svelte.js';
  import { formatDate, formatDuration } from '../lib/format.js';
  import type { ShellSessionEntry } from '../lib/types.js';
  import ConfirmModal from '../components/ConfirmModal.svelte';

  const client = getShellClient();

  let sessions = $state<ShellSessionEntry[]>([]);
  let error = $state('');
  let loading = $state(true);

  // Search & filter
  let searchQuery = $state('');
  let statusFilter = $state<'all' | 'active' | 'ended'>('all');

  // Terminate confirmation
  let showTerminateModal = $state(false);
  let terminateTarget = $state('');
  let terminateLoading = $state(false);

  let filteredSessions = $derived(
    sessions.filter((session) => {
      const matchesSearch =
        searchQuery === '' ||
        session.agentLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter =
        statusFilter === 'all' ||
        (statusFilter === 'active' && session.status === 'active') ||
        (statusFilter === 'ended' && session.status !== 'active');
      return matchesSearch && matchesFilter;
    }),
  );

  async function loadData() {
    try {
      const res = await client.getSessions();
      sessions = res.sessions;
      error = '';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadData();
    const interval = setInterval(loadData, 10_000);
    return () => clearInterval(interval);
  });

  function statusColor(status: string): string {
    switch (status) {
      case 'active':
        return 'text-success';
      case 'completed':
        return 'text-text-secondary';
      case 'pending':
        return 'text-warning';
      default:
        return 'text-text-secondary';
    }
  }

  function openTerminateModal(sessionId: string) {
    terminateTarget = sessionId;
    showTerminateModal = true;
  }

  async function handleTerminate() {
    terminateLoading = true;
    try {
      await client.terminateSession(terminateTarget);
      showTerminateModal = false;
      await loadData();
    } catch (e) {
      error = String(e);
    } finally {
      terminateLoading = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold text-text-primary">Sessions</h1>
    <button
      class="rounded-lg bg-card-hover px-3 py-1.5 text-sm text-text-primary hover:bg-border"
      onclick={loadData}
    >
      Refresh
    </button>
  </div>

  <!-- Search & Filter -->
  <div class="flex items-center gap-3">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search by agent or session ID..."
      class="flex-1 rounded border border-border bg-card px-3 py-1.5 text-sm text-text-primary placeholder-text-secondary"
    />
    <select
      bind:value={statusFilter}
      class="rounded border border-border bg-card px-3 py-1.5 text-sm text-text-primary"
    >
      <option value="all">All</option>
      <option value="active">Active</option>
      <option value="ended">Ended</option>
    </select>
  </div>

  {#if error}
    <div class="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="py-12 text-center text-text-secondary">Loading sessions...</div>
  {:else if sessions.length === 0}
    <div class="py-12 text-center text-text-secondary">No sessions recorded yet.</div>
  {:else if filteredSessions.length === 0}
    <div class="py-12 text-center text-text-secondary">No sessions match the current filter.</div>
  {:else}
    <div class="overflow-x-auto rounded-xl border border-border">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-border bg-card">
            <th class="px-4 py-3 font-medium text-text-secondary">Agent</th>
            <th class="px-4 py-3 font-medium text-text-secondary">Source IP</th>
            <th class="px-4 py-3 font-medium text-text-secondary">Started</th>
            <th class="px-4 py-3 font-medium text-text-secondary">Duration</th>
            <th class="px-4 py-3 font-medium text-text-secondary">Status</th>
            <th class="px-4 py-3 font-medium text-text-secondary"></th>
          </tr>
        </thead>
        <tbody>
          {#each filteredSessions as session}
            <tr class="border-b border-border/50 hover:bg-card/30">
              <td class="px-4 py-3 font-mono text-text-primary">{session.agentLabel}</td>
              <td class="px-4 py-3 font-mono text-text-secondary">{session.sourceIp}</td>
              <td class="px-4 py-3 text-text-secondary">{formatDate(session.startedAt)}</td>
              <td class="px-4 py-3 text-text-secondary">{formatDuration(session.duration ?? null)}</td>
              <td class="px-4 py-3 {statusColor(session.status)}">{session.status}</td>
              <td class="px-4 py-3">
                {#if session.status === 'active'}
                  <button
                    class="rounded-lg bg-red-900/50 px-3 py-1 text-xs text-red-300 hover:bg-red-900"
                    onclick={() => openTerminateModal(session.id)}
                  >
                    Terminate
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showTerminateModal}
  <ConfirmModal
    title="Terminate Session"
    confirmLabel={terminateLoading ? 'Terminating...' : 'Terminate'}
    loading={terminateLoading}
    onconfirm={handleTerminate}
    onclose={() => (showTerminateModal = false)}
  >
    Are you sure you want to terminate session <strong class="font-mono text-xs">{terminateTarget}</strong>?
    The active terminal connection will be closed immediately.
  </ConfirmModal>
{/if}
