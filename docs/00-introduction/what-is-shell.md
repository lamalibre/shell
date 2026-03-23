# What is Shell?

> Shell is a secure remote terminal system that gives you interactive shell access to remote machines via tmux, without SSH, without port forwarding, and without exposing new ports.

## In Plain English

Imagine you have a computer in another room — or another country — and you need to type commands on it. The traditional answer is SSH. But SSH requires an open port on the remote machine, firewall rules, key management, and direct network access.

Shell takes a different approach. A relay server sits between you and the remote machine. The remote machine connects _out_ to the relay through a WebSocket tunnel. When you want a terminal session, you connect to the same relay. The relay pairs your connections and you get an interactive terminal — as if you were sitting at the remote machine.

The remote machine runs tmux, so your session is a real terminal with scrollback, resize support, and full-screen apps. Every keystroke you type travels through the relay to tmux. Every screen update travels back. The relay never interprets the terminal data — it just forwards bytes.

The clever part: access is time-limited and policy-controlled. You enable shell access for a specific machine for a specific duration (say, 30 minutes). When the time window expires, the session ends. Every session is recorded. Every connection is authenticated with client certificates. There is no permanent open door.

## For Users

Shell solves the problem of secure, audited remote terminal access. Here is what you get:

**What it does:**

- Gives you an interactive terminal on remote machines via a WebSocket relay
- Authenticates every connection with mTLS client certificates
- Limits access to configurable time windows (5 minutes to 8 hours)
- Records every session via tmux pipe-pane for audit
- Blocks dangerous commands via an advisory blocklist
- Tracks all sessions in an audit log (last 500 entries)

**What you need:**

- A server machine (your Mac, a VPS, or a Portlama instance) to run the relay
- One or more remote machines (macOS or Linux) with tmux installed
- Node.js 22+ on all machines

**Two ways to deploy:**

| Mode | Server | Use case |
| --- | --- | --- |
| **Standalone** | Own CA, own API key, own server | SSH alternative on your LAN or with port forwarding |
| **Plugin** | Runs inside Portlama | Remote access through Portlama's existing relay and certificates |

**Key design choices:**

- No SSH — the agent connects outbound to the relay, so no inbound ports needed on the remote machine
- Time-limited access — no permanent open sessions; you enable access, use it, it expires
- Session recording — every terminal session is captured to disk on the agent machine
- Policy-based — IP allowlists, command blocklists, and per-agent policies

## For Developers

Shell is a monorepo with six packages:

| Package | Technology | Purpose |
| --- | --- | --- |
| `shell-server` | Fastify 5, node-forge, Zod | WebSocket relay + REST API (standalone + plugin) |
| `shell-agent` | Node.js ESM, tmux, execa | Agent daemon (tmux session manager) |
| `shell-cli` | @clack/prompts, picocolors | Admin CLI tool |
| `shell-desktop` | Tauri v2, Svelte 5, Tailwind | Desktop management app |
| `create-shell` | esbuild bundled, zero deps | npx installer |
| `shell-e2e-mcp` | MCP SDK | E2E test infrastructure |

**Architecture summary:**

```
Admin (CLI / Desktop)
    │
    │  WebSocket (wss://)
    ▼
Shell Server (Fastify, :9494)
  ├── REST API (config, policies, enable/disable, sessions)
  ├── WebSocket relay (pairs admin ↔ agent connections)
  └── Certificate management (CA, enrollment, mTLS)
    ▲
    │  WebSocket (wss://)
    │
Agent (tmux daemon)
  ├── Polls /api/shell/agent-status every 10s
  ├── Spawns tmux session when paired with admin
  ├── Captures output every 100ms
  └── Records session to ~/.shell-agent/recordings/
```

State is stored in JSON files with atomic writes (temp → fsync → rename). No database.

## Quick Reference

| Item | Value |
| --- | --- |
| **Install command** | `npx @lamalibre/create-shell` |
| **Default port** | 9494 (standalone) |
| **Auth (standalone)** | API key (admin) + mTLS certs (agents) |
| **Auth (plugin)** | Portlama mTLS certificates |
| **Session limit** | One session per agent at a time |
| **Time windows** | 5–480 minutes (default 30) |
| **Session recording** | tmux pipe-pane to `~/.shell-agent/recordings/` |
| **Audit log** | Last 500 entries in `shell-sessions.json` |
| **State storage** | JSON files (no database) |
| **Target OS** | macOS (launchd), Linux (systemd) |
| **License** | PolyForm Noncommercial 1.0.0 |
