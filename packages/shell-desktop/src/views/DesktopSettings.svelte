<script lang="ts">
  import { getShellConfig, updateShellConfig } from '../lib/api.js';
  import { Modal } from '@lamalibre/shell-panel';

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let serverUrl = $state('');
  let apiKey = $state('');
  let caCertPath = $state('');
  let certPath = $state('');
  let keyPath = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let success = $state('');
  let urlError = $state('');

  $effect(() => {
    loadConfig();
  });

  async function loadConfig() {
    try {
      const config = await getShellConfig();
      serverUrl = config.serverUrl;
      apiKey = config.apiKey;
      caCertPath = config.caCertPath ?? '';
      certPath = config.certPath ?? '';
      keyPath = config.keyPath ?? '';
      error = '';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  async function handleSave() {
    urlError = '';
    success = '';
    error = '';

    if (!validateUrl(serverUrl)) {
      urlError = 'Please enter a valid HTTP or HTTPS URL.';
      return;
    }

    saving = true;
    try {
      await updateShellConfig({
        serverUrl,
        apiKey,
        caCertPath: caCertPath || null,
        certPath: certPath || null,
        keyPath: keyPath || null,
      });
      success = 'Settings saved.';
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }
</script>

<Modal title="Settings" {onclose}>
  {#if loading}
    <div class="py-8 text-center text-text-secondary">Loading configuration...</div>
  {:else}
    <form class="space-y-4" onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
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

      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="settings-url">Server URL</label>
        <input
          id="settings-url"
          type="text"
          bind:value={serverUrl}
          required
          placeholder="https://localhost:9494"
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary
            {urlError ? 'border-red-600' : ''}"
        />
        {#if urlError}
          <p class="mt-1 text-xs text-error">{urlError}</p>
        {/if}
      </div>

      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="settings-key">API Key</label>
        <input
          id="settings-key"
          type="password"
          bind:value={apiKey}
          required
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="settings-ca">CA Certificate Path</label>
        <input
          id="settings-ca"
          type="text"
          bind:value={caCertPath}
          placeholder="(optional) /path/to/ca.crt"
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="settings-cert">Client Certificate Path</label>
        <input
          id="settings-cert"
          type="text"
          bind:value={certPath}
          placeholder="(optional) /path/to/client.crt"
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-sm text-text-secondary" for="settings-keypath">Client Key Path</label>
        <input
          id="settings-keypath"
          type="text"
          bind:value={keyPath}
          placeholder="(optional) /path/to/client.key"
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>

      <div class="flex justify-end gap-3 pt-2">
        <button
          type="button"
          class="rounded-lg bg-card-hover px-4 py-2 text-sm text-text-primary hover:bg-border"
          onclick={onclose}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          class="rounded-lg bg-accent px-4 py-2 text-sm text-surface hover:bg-accent-dim disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  {/if}
</Modal>
