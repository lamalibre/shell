<script lang="ts">
  import { getShellClient } from '../context/client.svelte.js';
  import { formatDate, formatDuration } from '../lib/format.js';
  import type { ShellAgent, RecordingEntry } from '../lib/types.js';

  const client = getShellClient();

  let agents = $state<ShellAgent[]>([]);
  let recordings = $state<RecordingEntry[]>([]);
  let selectedAgent = $state('');
  let error = $state('');
  let loading = $state(true);
  let recordingsLoading = $state(false);
  let downloadingId = $state('');

  async function loadAgents() {
    try {
      const res = await client.getAgents();
      agents = res.agents;
      error = '';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function loadRecordings() {
    if (!selectedAgent) {
      recordings = [];
      return;
    }
    recordingsLoading = true;
    try {
      const res = await client.getRecordings(selectedAgent);
      recordings = res.recordings;
      error = '';
    } catch (e) {
      error = String(e);
      recordings = [];
    } finally {
      recordingsLoading = false;
    }
  }

  $effect(() => {
    loadAgents();
  });

  $effect(() => {
    const _agent = selectedAgent;
    if (_agent) {
      loadRecordings();
      const interval = setInterval(loadRecordings, 15_000);
      return () => clearInterval(interval);
    } else {
      recordings = [];
    }
  });

  async function handleDownload(entry: RecordingEntry) {
    if (!selectedAgent) return;
    downloadingId = entry.sessionId;
    try {
      const content = await client.downloadRecording(selectedAgent, entry.sessionId);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recording-${selectedAgent}-${entry.sessionId}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      error = String(e);
    } finally {
      downloadingId = '';
    }
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'active':
        return 'text-success';
      case 'completed':
        return 'text-text-secondary';
      default:
        return 'text-text-secondary';
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold text-text-primary">Recordings</h1>
    <div class="flex items-center gap-3">
      <select
        bind:value={selectedAgent}
        class="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-text-primary"
      >
        <option value="">Select agent...</option>
        {#each agents as agent}
          <option value={agent.label}>{agent.label}</option>
        {/each}
      </select>
      <button
        class="rounded-lg bg-card-hover px-3 py-1.5 text-sm text-text-primary hover:bg-border"
        onclick={loadRecordings}
        disabled={!selectedAgent}
      >
        Refresh
      </button>
    </div>
  </div>

  {#if error}
    <div class="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="py-12 text-center text-text-secondary">Loading agents...</div>
  {:else if !selectedAgent}
    <div class="py-12 text-center text-text-secondary">Select an agent to view recordings.</div>
  {:else if recordingsLoading && recordings.length === 0}
    <div class="py-12 text-center text-text-secondary">Loading recordings...</div>
  {:else if recordings.length === 0}
    <div class="py-12 text-center text-text-secondary">No recordings found for this agent.</div>
  {:else}
    <div class="overflow-x-auto rounded-xl border border-border">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-border bg-card">
            <th class="px-4 py-3 font-medium text-text-secondary">Session ID</th>
            <th class="px-4 py-3 font-medium text-text-secondary">Started</th>
            <th class="px-4 py-3 font-medium text-text-secondary">Ended</th>
            <th class="px-4 py-3 font-medium text-text-secondary">Duration</th>
            <th class="px-4 py-3 font-medium text-text-secondary">Status</th>
            <th class="px-4 py-3 font-medium text-text-secondary"></th>
          </tr>
        </thead>
        <tbody>
          {#each recordings as entry}
            <tr class="border-b border-border/50 hover:bg-card/30">
              <td class="px-4 py-3 font-mono text-xs text-text-primary">{entry.sessionId}</td>
              <td class="px-4 py-3 text-text-secondary">{formatDate(entry.startedAt)}</td>
              <td class="px-4 py-3 text-text-secondary">{formatDate(entry.endedAt ?? null)}</td>
              <td class="px-4 py-3 text-text-secondary">{formatDuration(entry.duration ?? null)}</td>
              <td class="px-4 py-3 {statusColor(entry.status)}">{entry.status}</td>
              <td class="px-4 py-3">
                {#if entry.hasRecording !== false}
                  <button
                    class="rounded-lg bg-accent/20 px-3 py-1 text-xs text-accent hover:bg-accent/30 disabled:opacity-50"
                    onclick={() => handleDownload(entry)}
                    disabled={downloadingId === entry.sessionId}
                  >
                    {downloadingId === entry.sessionId ? 'Downloading...' : 'Download'}
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
