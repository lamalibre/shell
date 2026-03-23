<script lang="ts">
  import { getAgents, getRecordings, downloadRecording } from '../lib/api.js';
  import { formatDate, formatDuration } from '../lib/format.js';
  import type { ShellAgent, RecordingEntry } from '../lib/types.js';

  let agents = $state<ShellAgent[]>([]);
  let recordings = $state<RecordingEntry[]>([]);
  let selectedAgent = $state('');
  let error = $state('');
  let loading = $state(true);
  let recordingsLoading = $state(false);
  let downloadingId = $state('');

  async function loadAgents() {
    try {
      const res = await getAgents();
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
      const res = await getRecordings(selectedAgent);
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
    // Re-fetch recordings when agent changes
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
      const content = await downloadRecording(selectedAgent, entry.sessionId);
      // Create a downloadable blob via data URL
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
        return 'text-emerald-400';
      case 'completed':
        return 'text-zinc-400';
      default:
        return 'text-zinc-500';
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold text-zinc-100">Recordings</h1>
    <div class="flex items-center gap-3">
      <select
        bind:value={selectedAgent}
        class="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300"
      >
        <option value="">Select agent...</option>
        {#each agents as agent}
          <option value={agent.label}>{agent.label}</option>
        {/each}
      </select>
      <button
        class="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
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
    <div class="py-12 text-center text-zinc-500">Loading agents...</div>
  {:else if !selectedAgent}
    <div class="py-12 text-center text-zinc-500">Select an agent to view recordings.</div>
  {:else if recordingsLoading && recordings.length === 0}
    <div class="py-12 text-center text-zinc-500">Loading recordings...</div>
  {:else if recordings.length === 0}
    <div class="py-12 text-center text-zinc-500">No recordings found for this agent.</div>
  {:else}
    <div class="overflow-x-auto rounded-xl border border-zinc-800">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-zinc-800 bg-zinc-900/80">
            <th class="px-4 py-3 font-medium text-zinc-400">Session ID</th>
            <th class="px-4 py-3 font-medium text-zinc-400">Started</th>
            <th class="px-4 py-3 font-medium text-zinc-400">Ended</th>
            <th class="px-4 py-3 font-medium text-zinc-400">Duration</th>
            <th class="px-4 py-3 font-medium text-zinc-400">Status</th>
            <th class="px-4 py-3 font-medium text-zinc-400"></th>
          </tr>
        </thead>
        <tbody>
          {#each recordings as entry}
            <tr class="border-b border-zinc-800/50 hover:bg-zinc-900/30">
              <td class="px-4 py-3 font-mono text-xs text-zinc-200">{entry.sessionId}</td>
              <td class="px-4 py-3 text-zinc-400">{formatDate(entry.startedAt)}</td>
              <td class="px-4 py-3 text-zinc-400">{formatDate(entry.endedAt ?? null)}</td>
              <td class="px-4 py-3 text-zinc-400">{formatDuration(entry.duration ?? null)}</td>
              <td class="px-4 py-3 {statusColor(entry.status)}">{entry.status}</td>
              <td class="px-4 py-3">
                {#if entry.hasRecording !== false}
                  <button
                    class="rounded-lg bg-cyan-900/50 px-3 py-1 text-xs text-cyan-300 hover:bg-cyan-900 disabled:opacity-50"
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
