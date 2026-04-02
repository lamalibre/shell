# Desktop App

> The shell desktop app provides a graphical interface for managing agents, policies, sessions, recordings, and settings — built with Tauri v2 and Svelte 5.

## Overview

The desktop app is an alternative to the CLI for managing shell access. It connects to the shell server's REST API and provides a multi-tab interface:

- **Agents** — list agents, enable/disable access, connect to sessions
- **Policies** — create and manage access policies
- **Sessions** — view the session audit log
- **Recordings** — browse and play back session recordings
- **Settings** — configure server connection and preferences

The app runs natively on macOS (and Linux) via Tauri v2, using a Rust backend for HTTP calls and a Svelte 5 frontend styled with Tailwind v4.

### Shared Panel Architecture

The desktop app imports its page components from the `shell-panel` package — a shared Svelte 5 UI component library that provides pages, reusable components, and API client helpers. This means the same UI is used by both the desktop app and the Portlama panel (a self-registering IIFE loaded by the Portlama host, not served by the shell server). The desktop app provides the app shell and routing; `shell-panel` provides the page content.

## Installation

The desktop app is built from source as part of the monorepo:

```bash
cd packages/shell-desktop
pnpm install
pnpm tauri build
```

The built app is located in `src-tauri/target/release/bundle/`.

## Configuration

On first launch, the app creates a config file at `~/.shell-desktop/config.json`:

```json
{
  "serverUrl": "https://localhost:9494",
  "apiKey": "<contents of ~/.shell/api-key>",
  "caPath": "~/.shell/ca.crt"
}
```

The app falls back to reading `~/.shell/api-key` for standalone server defaults.

## Features

### Status Indicator

The sidebar shows a connection status indicator:
- **Server Online** (green) — health check passes
- **Server Offline** (red) — health check fails

The app polls `/api/shell/health` every 30 seconds.

### Global Toggle

A toggle at the bottom of the sidebar enables or disables shell access globally. This maps to `PATCH /api/shell/config { enabled: true/false }`.

### Agents Tab

Lists all enrolled agents with:
- Agent label
- Status indicator (green = access enabled, red = revoked)
- Time remaining (e.g., "15m 30s remaining")

**Actions:**
- **Enable** — opens a modal to select duration (5m–8h) and policy, calls `POST /api/shell/enable/:label`
- **Disable** — calls `DELETE /api/shell/enable/:label`
- **Connect** — spawns `shell-cli connect <label>` in a terminal window via Tauri's shell plugin

### Policies Tab

Create, update, and delete access policies:
- Policy name and description
- Allowed and denied IP ranges (CIDR)
- Inactivity timeout
- Mark as default policy

### Sessions Tab

Displays the audit log as a table:
- Agent label
- Source IP
- Start time (formatted)
- Duration
- Status (active/ended)

The table auto-refreshes every 10 seconds.

## Architecture

```
┌────────────────────────────────┐
│  Desktop App Shell (Svelte 5)  │
│  ├── Routing + layout          │
│  └── Tauri-specific wiring     │
│           │                    │
│           │ imports pages      │
│           ▼                    │
│  shell-panel (shared library)  │
│  ├── AgentsPage.svelte         │
│  ├── PoliciesPage.svelte       │
│  ├── SessionsPage.svelte       │
│  ├── RecordingsPage.svelte     │
│  └── SettingsPage.svelte       │
│           │                    │
│           │ invoke()           │
│           ▼                    │
│  Tauri IPC (Rust)              │
│  ├── get_agents()              │
│  ├── enable_agent_shell()      │
│  ├── get_shell_policies()      │
│  ├── get_shell_sessions()      │
│  └── check_health()           │
│           │                    │
│           │ curl (via std::    │
│           │ process::Command)  │
│           ▼                    │
│  Shell Server REST API         │
└────────────────────────────────┘
```

The Rust backend uses `curl` via `tokio::task::spawn_blocking` to make HTTP calls — this avoids blocking the Tauri event loop. Authentication is handled via a temporary curl config file (created with mode `0600`, cleaned up after each request) to keep the API key out of process arguments.

## Related Documentation

- [CLI Usage](cli-usage.md) — command-line alternative
- [API Overview](../04-api-reference/overview.md) — REST endpoints the app calls
- [Shell Server](../03-architecture/shell-server.md) — server-side architecture
