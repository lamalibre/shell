<script lang="ts">
  import Modal from './Modal.svelte';
  import { Copy, Check, Monitor } from 'lucide-svelte';

  interface Props {
    title: string;
    command: string;
    onclose: () => void;
  }

  let { title, command, onclose }: Props = $props();
  let copied = $state(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      // Fallback: select the text for manual copy
      const el = document.getElementById('desktop-action-command') as HTMLInputElement | null;
      if (el) el.select();
    }
  }
</script>

<Modal {title} {onclose}>
  <div class="space-y-4">
    <p class="text-sm text-text-secondary">
      This action requires the Shell desktop app or CLI.
      Run the following command in your terminal:
    </p>

    <div class="flex items-center gap-2">
      <input
        id="desktop-action-command"
        type="text"
        readonly
        value={command}
        class="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text-primary"
      />
      <button
        class="shrink-0 rounded-lg bg-accent/20 px-3 py-2 text-sm text-accent hover:bg-accent/30"
        onclick={copyCommand}
      >
        {#if copied}
          <Check class="h-4 w-4" />
        {:else}
          <Copy class="h-4 w-4" />
        {/if}
      </button>
    </div>

    <div class="rounded-lg border border-border bg-surface px-4 py-3">
      <div class="flex items-center gap-2 text-sm text-text-secondary">
        <Monitor class="h-4 w-4" />
        <span>Don't have the desktop app?</span>
      </div>
      <div class="mt-2">
        <code class="block rounded bg-card px-3 py-2 font-mono text-xs text-accent">
          npx @lamalibre/install-shell-desktop
        </code>
      </div>
    </div>

    <div class="flex justify-end pt-2">
      <button
        class="rounded-lg bg-card-hover px-4 py-2 text-sm text-text-primary hover:bg-border"
        onclick={onclose}
      >
        Close
      </button>
    </div>
  </div>
</Modal>
