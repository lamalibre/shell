<script lang="ts">
  import { getShellClient } from '../context/client.svelte.js';
  import type { ShellPolicy, CreatePolicyPayload, UpdatePolicyPayload } from '../lib/types.js';
  import Modal from '../components/Modal.svelte';
  import ConfirmModal from '../components/ConfirmModal.svelte';

  const client = getShellClient();

  let policies = $state<ShellPolicy[]>([]);
  let defaultPolicy = $state('');
  let error = $state('');
  let loading = $state(true);

  // Search
  let searchQuery = $state('');

  // Form state
  let showForm = $state(false);
  let editingId = $state<string | null>(null);
  let formName = $state('');
  let formDescription = $state('');
  let formAllowedIps = $state('');
  let formDeniedIps = $state('');
  let formInactivityTimeout = $state(900);
  let formMaxFileSizeMb = $state(100);
  let formHardBlocked = $state('');
  let formRestricted = $state('');
  let formSaving = $state(false);

  // Delete confirm
  let showDeleteConfirm = $state(false);
  let deleteTarget = $state('');
  let deleteLoading = $state(false);

  let filteredPolicies = $derived(
    policies.filter((p) => {
      if (searchQuery === '') return true;
      return p.name.toLowerCase().includes(searchQuery.toLowerCase());
    }),
  );

  async function loadData() {
    try {
      const res = await client.getPolicies();
      policies = res.policies;
      defaultPolicy = res.defaultPolicy;
      error = '';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadData();
  });

  function openCreate() {
    editingId = null;
    formName = '';
    formDescription = '';
    formAllowedIps = '';
    formDeniedIps = '';
    formInactivityTimeout = 900;
    formMaxFileSizeMb = 100;
    formHardBlocked = '';
    formRestricted = '';
    showForm = true;
  }

  function openEdit(policy: ShellPolicy) {
    editingId = policy.id;
    formName = policy.name;
    formDescription = policy.description;
    formAllowedIps = policy.allowedIps.join(', ');
    formDeniedIps = policy.deniedIps.join(', ');
    formInactivityTimeout = policy.inactivityTimeout;
    formMaxFileSizeMb = Math.round(policy.maxFileSize / 1048576);
    formHardBlocked = policy.commandBlocklist.hardBlocked.join('\n');
    formRestricted = Object.keys(policy.commandBlocklist.restricted).join('\n');
    showForm = true;
  }

  function parseIpList(input: string): string[] {
    return input
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function parseLines(input: string): string[] {
    return input
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function parseRestricted(input: string): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const line of parseLines(input)) {
      result[line] = true;
    }
    return result;
  }

  async function handleSave() {
    formSaving = true;
    try {
      const commandBlocklist = {
        hardBlocked: parseLines(formHardBlocked),
        restricted: parseRestricted(formRestricted),
      };
      const maxFileSize = formMaxFileSizeMb * 1048576;

      if (editingId) {
        const payload: UpdatePolicyPayload = {
          name: formName,
          description: formDescription,
          allowedIps: parseIpList(formAllowedIps),
          deniedIps: parseIpList(formDeniedIps),
          inactivityTimeout: formInactivityTimeout,
          maxFileSize,
          commandBlocklist,
        };
        await client.updatePolicy(editingId, payload);
      } else {
        const payload: CreatePolicyPayload = {
          name: formName,
          description: formDescription,
          allowedIps: parseIpList(formAllowedIps),
          deniedIps: parseIpList(formDeniedIps),
          inactivityTimeout: formInactivityTimeout,
          maxFileSize,
          commandBlocklist,
        };
        await client.createPolicy(payload);
      }
      showForm = false;
      await loadData();
    } catch (e) {
      error = String(e);
    } finally {
      formSaving = false;
    }
  }

  function confirmDelete(policyId: string) {
    deleteTarget = policyId;
    showDeleteConfirm = true;
  }

  async function handleDelete() {
    deleteLoading = true;
    try {
      await client.deletePolicy(deleteTarget);
      showDeleteConfirm = false;
      await loadData();
    } catch (e) {
      error = String(e);
    } finally {
      deleteLoading = false;
    }
  }

  function formatFileSize(bytes: number): string {
    const mb = Math.round(bytes / 1048576);
    return `${mb} MB`;
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold text-text-primary">Policies</h1>
    <button
      class="rounded-lg bg-accent px-3 py-1.5 text-sm text-surface hover:bg-accent-dim"
      onclick={openCreate}
    >
      New Policy
    </button>
  </div>

  <!-- Search -->
  <div>
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search policies..."
      class="w-full rounded border border-border bg-card px-3 py-1.5 text-sm text-text-primary placeholder-text-secondary"
    />
  </div>

  {#if error}
    <div class="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="py-12 text-center text-text-secondary">Loading policies...</div>
  {:else if policies.length === 0}
    <div class="py-12 text-center text-text-secondary">No policies configured.</div>
  {:else if filteredPolicies.length === 0}
    <div class="py-12 text-center text-text-secondary">No policies match the search.</div>
  {:else}
    <div class="grid gap-3">
      {#each filteredPolicies as policy}
        <div class="rounded-xl border border-border bg-card p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="font-medium text-text-primary">{policy.name}</span>
              <span class="font-mono text-xs text-text-secondary">{policy.id}</span>
              {#if policy.id === defaultPolicy}
                <span class="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent">Default</span>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              <button
                class="rounded-lg bg-card-hover px-3 py-1.5 text-sm text-text-primary hover:bg-border"
                onclick={() => openEdit(policy)}
              >
                Edit
              </button>
              {#if policy.id !== defaultPolicy}
                <button
                  class="rounded-lg bg-red-900/50 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900"
                  onclick={() => confirmDelete(policy.id)}
                >
                  Delete
                </button>
              {/if}
            </div>
          </div>
          {#if policy.description}
            <p class="mt-1 text-sm text-text-secondary">{policy.description}</p>
          {/if}
          <div class="mt-3 flex flex-wrap gap-4 text-xs text-text-secondary">
            <span>Allowed IPs: {policy.allowedIps.length > 0 ? policy.allowedIps.join(', ') : 'any'}</span>
            <span>Denied IPs: {policy.deniedIps.length > 0 ? policy.deniedIps.join(', ') : 'none'}</span>
            <span>Inactivity: {Math.floor(policy.inactivityTimeout / 60)}m</span>
            <span>Max File Size: {formatFileSize(policy.maxFileSize)}</span>
            <span>Hard Blocked: {policy.commandBlocklist.hardBlocked.length}</span>
            <span>Restricted: {Object.keys(policy.commandBlocklist.restricted).length}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if showForm}
  <Modal title={editingId ? 'Edit Policy' : 'Create Policy'} onclose={() => (showForm = false)}>
    <form class="max-h-[70vh] space-y-4 overflow-y-auto pr-2" onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="policy-name">Name</label>
        <input
          id="policy-name"
          type="text"
          bind:value={formName}
          required
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="policy-desc">Description</label>
        <input
          id="policy-desc"
          type="text"
          bind:value={formDescription}
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="policy-allowed">Allowed IPs (comma-separated)</label>
        <input
          id="policy-allowed"
          type="text"
          bind:value={formAllowedIps}
          placeholder="Leave empty to allow all"
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="policy-denied">Denied IPs (comma-separated)</label>
        <input
          id="policy-denied"
          type="text"
          bind:value={formDeniedIps}
          placeholder="Leave empty for no denials"
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="policy-timeout">Inactivity Timeout (seconds)</label>
        <input
          id="policy-timeout"
          type="number"
          bind:value={formInactivityTimeout}
          min={60}
          max={7200}
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="policy-maxfilesize">Max File Size (MB)</label>
        <input
          id="policy-maxfilesize"
          type="number"
          bind:value={formMaxFileSizeMb}
          min={1}
          max={10240}
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
        <p class="mt-1 text-xs text-text-secondary">Maximum file size for uploads/downloads. Default: 100 MB.</p>
      </div>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="policy-hardblocked">Hard Blocked Commands (one per line)</label>
        <textarea
          id="policy-hardblocked"
          bind:value={formHardBlocked}
          rows={3}
          placeholder="rm&#10;dd&#10;mkfs"
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text-primary"
        ></textarea>
        <p class="mt-1 text-xs text-text-secondary">Commands that are completely blocked from execution.</p>
      </div>
      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="policy-restricted">Restricted Commands (one per line)</label>
        <textarea
          id="policy-restricted"
          bind:value={formRestricted}
          rows={3}
          placeholder="sudo&#10;su&#10;chmod"
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text-primary"
        ></textarea>
        <p class="mt-1 text-xs text-text-secondary">Commands treated as prefix restrictions (advisory).</p>
      </div>
      <div class="flex justify-end gap-3 pt-2">
        <button
          type="button"
          class="rounded-lg bg-card-hover px-4 py-2 text-sm text-text-primary hover:bg-border"
          onclick={() => (showForm = false)}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={formSaving}
          class="rounded-lg bg-accent px-4 py-2 text-sm text-surface hover:bg-accent-dim disabled:opacity-50"
        >
          {formSaving ? 'Saving...' : editingId ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  </Modal>
{/if}

{#if showDeleteConfirm}
  <ConfirmModal
    title="Delete Policy"
    confirmLabel="Delete"
    loading={deleteLoading}
    onconfirm={handleDelete}
    onclose={() => (showDeleteConfirm = false)}
  >
    Are you sure you want to delete policy <strong class="font-mono">{deleteTarget}</strong>?
    This cannot be undone.
  </ConfirmModal>
{/if}
