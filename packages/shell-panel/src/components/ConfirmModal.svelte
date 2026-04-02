<script lang="ts">
  import type { Snippet } from 'svelte';
  import Modal from './Modal.svelte';

  interface Props {
    title: string;
    confirmLabel?: string | undefined;
    confirmVariant?: 'danger' | 'primary' | undefined;
    loading?: boolean | undefined;
    error?: string | undefined;
    onconfirm: () => void;
    onclose: () => void;
    children: Snippet;
  }

  let {
    title,
    confirmLabel = 'Confirm',
    confirmVariant = 'danger',
    loading = false,
    error = '',
    onconfirm,
    onclose,
    children,
  }: Props = $props();

  const confirmClass = $derived(
    confirmVariant === 'danger'
      ? 'bg-red-700 text-white hover:bg-red-600'
      : 'bg-accent text-surface hover:bg-accent-dim',
  );
</script>

<Modal {title} {onclose}>
  {#if error}
    <div class="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  {/if}
  <div class="text-sm text-text-primary">
    {@render children()}
  </div>
  <div class="mt-6 flex justify-end gap-3">
    <button
      class="rounded-lg bg-card-hover px-4 py-2 text-sm text-text-primary hover:bg-border"
      onclick={onclose}
    >
      Cancel
    </button>
    <button
      class="rounded-lg px-4 py-2 text-sm disabled:opacity-50 {confirmClass}"
      onclick={onconfirm}
      disabled={loading}
    >
      {loading ? 'Processing...' : confirmLabel}
    </button>
  </div>
</Modal>
