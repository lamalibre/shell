<script lang="ts">
  interface Props {
    title: string;
    onclose: () => void;
  }

  let { title, onclose, children }: Props & { children: import('svelte').Snippet } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_interactive_supports_focus -->
<div
  role="dialog"
  tabindex="-1"
  aria-modal="true"
  aria-label={title}
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  onclick={handleBackdropClick}
>
  <div class="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
    <div class="flex items-center justify-between border-b border-border px-6 py-4">
      <h2 class="text-lg font-semibold text-text-primary">{title}</h2>
      <button
        aria-label="Close"
        class="rounded p-1 text-text-secondary hover:bg-card-hover hover:text-text-primary"
        onclick={onclose}
      >
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="px-6 py-4">
      {@render children()}
    </div>
  </div>
</div>
