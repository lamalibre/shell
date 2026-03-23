/**
 * Shell plugin panel — vanilla JS microfrontend for the Portlama desktop app.
 *
 * Contract:
 * - Evaluated via `new Function()` in the desktop app
 * - Must register `window.__portlamaPlugins.shell = { mount(ctx) }`
 * - ctx: { mountPoint: HTMLElement, panelUrl: string, basePath: string, subPath: string }
 * - Returns `{ unmount() }` for cleanup
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PanelCtx {
  mountPoint: HTMLElement;
  panelUrl: string;
  basePath: string;
  subPath: string;
}

let _apiBase = '';

function setApiBase(ctx: PanelCtx): void {
  const pluginName = ctx.basePath.split('/').pop() || 'shell';
  // Routes are mounted at /<pluginName>/... (no /api/shell sub-prefix)
  _apiBase = `${ctx.panelUrl}/${pluginName}`;
}

async function apiFetch(path: string): Promise<unknown> {
  const res = await fetch(`${_apiBase}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function apiFetchOptional(path: string): Promise<unknown | null> {
  const res = await fetch(`${_apiBase}${path}`, { credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

function el(
  tag: string,
  attrs?: Record<string, string> | null,
  ...children: (string | HTMLElement)[]
): HTMLElement {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') node.className = v;
      else node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

function badge(label: string, color: string): HTMLElement {
  return el('span', {
    className: 'shell-badge',
    style: `color: ${color}; border-color: ${color}40; background: ${color}15`,
  }, label);
}

function stat(label: string, value: string | number, color: string): HTMLElement {
  return el('div', { className: 'shell-stat-card' },
    el('span', { className: 'shell-stat-label' }, label),
    el('span', { className: 'shell-stat-value', style: `color: ${color}` }, String(value)),
  );
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles(): void {
  if (document.getElementById('shell-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'shell-panel-styles';
  style.textContent = `
    .shell-panel { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; color: #e4e4e7; }
    .shell-panel h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.25rem 0; }
    .shell-panel h2 { font-size: 0.875rem; font-weight: 500; color: #a1a1aa; margin: 1.5rem 0 0.75rem 0; }
    .shell-panel p.sub { font-size: 0.875rem; color: #71717a; margin: 0 0 1.5rem 0; }
    .shell-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
    .shell-stat-card { background: #18181b; border: 1px solid #27272a; border-radius: 0.5rem; padding: 0.75rem 1rem; }
    .shell-stat-label { display: block; font-size: 0.75rem; color: #71717a; margin-bottom: 0.25rem; }
    .shell-stat-value { display: block; font-size: 1.125rem; font-weight: 600; }
    .shell-badge { font-size: 0.75rem; padding: 0.125rem 0.5rem; border-radius: 0.375rem; border: 1px solid; }
    .shell-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .shell-table th { text-align: left; padding: 0.75rem 1rem; color: #71717a; font-weight: 500; border-bottom: 1px solid #27272a; }
    .shell-table td { padding: 0.75rem 1rem; border-bottom: 1px solid #27272a20; }
    .shell-table tr:hover td { background: #18181b40; }
    .shell-table-wrap { border: 1px solid #27272a; border-radius: 0.5rem; overflow: hidden; }
    .shell-card { background: #18181b; border: 1px solid #27272a; border-radius: 0.5rem; padding: 1rem; margin-bottom: 0.75rem; }
    .shell-card-title { font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; }
    .shell-card-row { display: flex; justify-content: space-between; font-size: 0.8125rem; padding: 0.25rem 0; }
    .shell-card-label { color: #71717a; }
    .shell-loading { display: flex; align-items: center; justify-content: center; min-height: 16rem; color: #71717a; font-size: 0.875rem; }
    .shell-error { padding: 1rem; border: 1px solid #f8717130; background: #f8717108; border-radius: 0.5rem; color: #f87171; font-size: 0.875rem; }
    .shell-error button { margin-top: 0.75rem; padding: 0.375rem 1rem; border: 1px solid #f8717130; background: #f8717110; color: #f87171; border-radius: 0.375rem; cursor: pointer; font-size: 0.875rem; }
    .shell-empty { text-align: center; padding: 3rem 1rem; color: #71717a; font-size: 0.875rem; }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Terminals page (default)
// ---------------------------------------------------------------------------

interface ShellAgent {
  label: string;
  revoked?: boolean;
  shellEnabledUntil?: string;
  shellPolicy?: string;
}

interface ShellSession {
  id: string;
  agentLabel: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  status: string;
  clientIp?: string;
}

function renderTerminals(root: HTMLElement): () => void {
  root.innerHTML = '';
  const wrap = el('div', { className: 'shell-panel' });
  root.appendChild(wrap);

  wrap.appendChild(el('h1', null, 'Shell'));
  wrap.appendChild(el('p', { className: 'sub' }, 'Secure remote terminal via tmux'));

  const statsEl = el('div', { className: 'shell-stats' });
  wrap.appendChild(statsEl);

  wrap.appendChild(el('h2', null, 'Agents'));
  const agentsEl = el('div');
  wrap.appendChild(agentsEl);

  wrap.appendChild(el('h2', null, 'Recent Sessions'));
  const sessionsEl = el('div');
  wrap.appendChild(sessionsEl);

  let cancelled = false;

  async function refresh(): Promise<void> {
    try {
      const [agentsRes, sessionsRes] = await Promise.all([
        apiFetchOptional('/agents') as Promise<{ agents: ShellAgent[] } | null>,
        apiFetch('/sessions') as Promise<{ sessions: ShellSession[] }>,
      ]);

      if (cancelled) return;

      const agents = agentsRes?.agents ?? [];
      const sessions = sessionsRes.sessions ?? [];
      const activeAgents = agents.filter((a) => !a.revoked);
      const activeSessions = sessions.filter((s) => s.status === 'active');

      // Stats
      statsEl.innerHTML = '';
      statsEl.appendChild(stat('Agents', `${activeAgents.length}/${agents.length}`, '#34d399'));
      statsEl.appendChild(stat('Active Sessions', activeSessions.length, '#22d3ee'));
      statsEl.appendChild(stat('Total Sessions', sessions.length, '#e4e4e7'));

      // Agents table
      agentsEl.innerHTML = '';
      if (agents.length === 0) {
        agentsEl.appendChild(el('div', { className: 'shell-empty' }, 'No agents registered.'));
      } else {
        const tableWrap = el('div', { className: 'shell-table-wrap' });
        const table = el('table', { className: 'shell-table' });
        const thead = el('thead');
        const headerRow = el('tr');
        for (const h of ['Label', 'Status', 'Shell Access', 'Policy']) {
          headerRow.appendChild(el('th', null, h));
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = el('tbody');
        for (const a of agents) {
          const row = el('tr');
          row.appendChild(el('td', { style: 'font-family: ui-monospace, monospace' }, a.label));

          const statusColor = a.revoked ? '#f87171' : '#34d399';
          const statusLabel = a.revoked ? 'Revoked' : 'Active';
          row.appendChild(el('td', null, badge(statusLabel, statusColor)));

          // Shell access window
          if (a.revoked) {
            row.appendChild(el('td', { style: 'color: #71717a' }, '—'));
          } else if (a.shellEnabledUntil) {
            const until = new Date(a.shellEnabledUntil);
            const remaining = until.getTime() - Date.now();
            if (remaining > 0) {
              const mins = Math.ceil(remaining / 60_000);
              row.appendChild(el('td', null, badge(`${mins}m remaining`, '#22d3ee')));
            } else {
              row.appendChild(el('td', null, badge('Expired', '#a1a1aa')));
            }
          } else {
            row.appendChild(el('td', { style: 'color: #71717a' }, 'Not enabled'));
          }

          row.appendChild(el('td', { style: 'color: #a1a1aa' }, a.shellPolicy ?? 'default'));
          tbody.appendChild(row);
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        agentsEl.appendChild(tableWrap);
      }

      // Sessions table
      sessionsEl.innerHTML = '';
      if (sessions.length === 0) {
        sessionsEl.appendChild(el('div', { className: 'shell-empty' }, 'No sessions recorded.'));
      } else {
        const tableWrap = el('div', { className: 'shell-table-wrap' });
        const table = el('table', { className: 'shell-table' });
        const thead = el('thead');
        const headerRow = el('tr');
        for (const h of ['Agent', 'Status', 'Started', 'Duration', 'IP']) {
          headerRow.appendChild(el('th', null, h));
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = el('tbody');
        const recent = sessions.slice(-20).reverse();
        for (const s of recent) {
          const row = el('tr');
          row.appendChild(el('td', { style: 'font-family: ui-monospace, monospace' }, s.agentLabel));

          const stColor = s.status === 'active' ? '#22d3ee' : s.status === 'ended' ? '#a1a1aa' : '#f87171';
          row.appendChild(el('td', null, badge(s.status, stColor)));

          row.appendChild(el('td', { style: 'color: #71717a' }, timeAgo(s.startedAt)));

          const durStr = s.duration != null ? `${Math.round(s.duration)}s` : s.status === 'active' ? 'ongoing' : '—';
          row.appendChild(el('td', { style: 'color: #a1a1aa' }, durStr));

          row.appendChild(el('td', { style: 'color: #71717a' }, s.clientIp ?? '—'));
          tbody.appendChild(row);
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        sessionsEl.appendChild(tableWrap);
      }
    } catch (err: unknown) {
      if (cancelled) return;
      agentsEl.innerHTML = '';
      sessionsEl.innerHTML = '';
      const errEl = el('div', { className: 'shell-error' }, String(err));
      const retryBtn = el('button', null, 'Retry');
      retryBtn.onclick = () => void refresh();
      errEl.appendChild(retryBtn);
      agentsEl.appendChild(errEl);
    }
  }

  void refresh();
  const interval = setInterval(() => void refresh(), 10_000);

  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

interface ShellConfig {
  enabled: boolean;
  defaultPolicy: string;
  policies: Array<{
    id: string;
    name: string;
    maxSessionDuration?: number;
    idleTimeout?: number;
    ipAllowlist?: string[];
    ipBlocklist?: string[];
    commandBlocklist?: string[];
    allowFileTransfer?: boolean;
    maxFileSize?: number;
  }>;
}

function renderSettings(root: HTMLElement): () => void {
  root.innerHTML = '';
  const wrap = el('div', { className: 'shell-panel' });
  root.appendChild(wrap);

  wrap.appendChild(el('h1', null, 'Settings'));
  wrap.appendChild(el('p', { className: 'sub' }, 'Shell configuration and access policies'));

  const content = el('div');
  wrap.appendChild(content);

  let cancelled = false;

  async function refresh(): Promise<void> {
    try {
      const config = await apiFetch('/config') as ShellConfig;
      if (cancelled) return;

      content.innerHTML = '';

      // General config card
      const generalCard = el('div', { className: 'shell-card' });
      generalCard.appendChild(el('div', { className: 'shell-card-title' }, 'General'));
      generalCard.appendChild(
        el('div', { className: 'shell-card-row' },
          el('span', { className: 'shell-card-label' }, 'Shell Access'),
          badge(config.enabled ? 'Enabled' : 'Disabled', config.enabled ? '#34d399' : '#f87171'),
        ),
      );
      generalCard.appendChild(
        el('div', { className: 'shell-card-row' },
          el('span', { className: 'shell-card-label' }, 'Default Policy'),
          el('span', null, config.defaultPolicy || 'none'),
        ),
      );
      content.appendChild(generalCard);

      // Policies
      const policies = config.policies ?? [];
      if (policies.length > 0) {
        for (const policy of policies) {
          const card = el('div', { className: 'shell-card' });
          card.appendChild(el('div', { className: 'shell-card-title' }, `Policy: ${policy.name}`));

          const fields: Array<[string, string]> = [
            ['ID', policy.id],
          ];

          if (policy.maxSessionDuration != null) {
            fields.push(['Max Session', `${policy.maxSessionDuration}s`]);
          }
          if (policy.idleTimeout != null) {
            fields.push(['Idle Timeout', `${policy.idleTimeout}s`]);
          }
          if (policy.ipAllowlist && policy.ipAllowlist.length > 0) {
            fields.push(['IP Allowlist', policy.ipAllowlist.join(', ')]);
          }
          if (policy.ipBlocklist && policy.ipBlocklist.length > 0) {
            fields.push(['IP Blocklist', policy.ipBlocklist.join(', ')]);
          }
          if (policy.commandBlocklist && policy.commandBlocklist.length > 0) {
            fields.push(['Blocked Commands', policy.commandBlocklist.join(', ')]);
          }
          fields.push(['File Transfer', policy.allowFileTransfer ? 'Allowed' : 'Blocked']);
          if (policy.maxFileSize != null) {
            const mb = (policy.maxFileSize / 1_048_576).toFixed(0);
            fields.push(['Max File Size', `${mb} MB`]);
          }

          for (const [label, value] of fields) {
            card.appendChild(
              el('div', { className: 'shell-card-row' },
                el('span', { className: 'shell-card-label' }, label),
                el('span', null, value),
              ),
            );
          }

          content.appendChild(card);
        }
      } else {
        content.appendChild(el('div', { className: 'shell-empty' }, 'No policies configured.'));
      }
    } catch (err: unknown) {
      if (cancelled) return;
      content.innerHTML = '';
      const errEl = el('div', { className: 'shell-error' }, String(err));
      const retryBtn = el('button', null, 'Retry');
      retryBtn.onclick = () => void refresh();
      errEl.appendChild(retryBtn);
      content.appendChild(errEl);
    }
  }

  void refresh();
  return () => { cancelled = true; };
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function mount(ctx: PanelCtx): { unmount: () => void } {
  injectStyles();
  setApiBase(ctx);

  let cleanup: (() => void) | undefined;

  if (ctx.subPath === '/settings' || ctx.subPath === 'settings') {
    cleanup = renderSettings(ctx.mountPoint);
  } else {
    cleanup = renderTerminals(ctx.mountPoint);
  }

  return {
    unmount: () => {
      cleanup?.();
      ctx.mountPoint.innerHTML = '';
    },
  };
}

// Register on global
(window as unknown as Record<string, unknown>).__portlamaPlugins =
  (window as unknown as Record<string, unknown>).__portlamaPlugins ?? {};
((window as unknown as Record<string, unknown>).__portlamaPlugins as Record<string, unknown>).shell = { mount };
