<script lang="ts">
  import { getSessions, terminateSession } from '../lib/api.js';
  import { formatDate, formatDuration } from '../lib/format.js';
  import type { ShellSessionEntry } from '../lib/types.js';
  import Modal from '../components/Modal.svelte';

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
      const res = await getSessions();
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
        return 'text-emerald-400';
      case 'completed':
        return 'text-zinc-400';
      case 'pending':
        return 'text-amber-400';
      default:
        return 'text-zinc-500';
    }
  }

  function openTerminateModal(sessionId: string) {
    terminateTarget = sessionId;
    showTerminateModal = true;
  }

  async function handleTerminate() {
    terminateLoading = true;
    try {
      await terminateSession(terminateTarget);
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
    <h1 class="text-xl font-bold text-zinc-100">Sessions</h1>
    <button
      class="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
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
      class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500"
    />
    <select
      bind:value={statusFilter}
      class="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
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
    <div class="py-12 text-center text-zinc-500">Loading sessions...</div>
  {:else if sessions.length === 0}
    <div class="py-12 text-center text-zinc-500">No sessions recorded yet.</div>
  {:else if filteredSessions.length === 0}
    <div class="py-12 text-center text-zinc-500">No sessions match the current filter.</div>
  {:else}
    <div class="overflow-x-auto rounded-xl border border-zinc-800">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-zinc-800 bg-zinc-900/80">
            <th class="px-4 py-3 font-medium text-zinc-400">Agent</th>
            <th class="px-4 py-3 font-medium text-zinc-400">Source IP</th>
            <th class="px-4 py-3 font-medium text-zinc-400">Started</th>
            <th class="px-4 py-3 font-medium text-zinc-400">Duration</th>
            <th class="px-4 py-3 font-medium text-zinc-400">Status</th>
            <th class="px-4 py-3 font-medium text-zinc-400"></th>
          </tr>
        </thead>
        <tbody>
          {#each filteredSessions as session}
            <tr class="border-b border-zinc-800/50 hover:bg-zinc-900/30">
              <td class="px-4 py-3 font-mono text-zinc-200">{session.agentLabel}</td>
              <td class="px-4 py-3 font-mono text-zinc-400">{session.sourceIp}</td>
              <td class="px-4 py-3 text-zinc-400">{formatDate(session.startedAt)}</td>
              <td class="px-4 py-3 text-zinc-400">{formatDuration(session.duration ?? null)}</td>
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
  <Modal title="Terminate Session" onclose={() => (showTerminateModal = false)}>
    <p class="text-sm text-zinc-300">
      Are you sure you want to terminate session <strong class="font-mono text-xs">{terminateTarget}</strong>?
      The active terminal connection will be closed immediately.
    </p>
    <div class="mt-6 flex justify-end gap-3">
      <button
        class="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
        onclick={() => (showTerminateModal = false)}
      >
        Cancel
      </button>
      <button
        class="rounded-lg bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-600 disabled:opacity-50"
        onclick={handleTerminate}
        disabled={terminateLoading}
      >
        {terminateLoading ? 'Terminating...' : 'Terminate'}
      </button>
    </div>
  </Modal>
{/if}
