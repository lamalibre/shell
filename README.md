# Shell

Secure remote terminal access via tmux — standalone and Portlama plugin.

No SSH. No port forwarding. No new ports exposed on the remote machine.

## What It Does

Shell gives you interactive terminal sessions on remote machines through a WebSocket relay. The remote machine connects _outbound_ to the relay — no inbound ports needed. Access is time-limited (5 minutes to 8 hours), policy-controlled, and every session is recorded.

```
Admin (CLI / Desktop)          Shell Server (relay)           Agent (remote machine)
       │                              │                              │
       │  Enable access (30 min)      │                              │
       ├─────────────────────────────►│                              │
       │                              │  Agent polls, detects access │
       │                              │◄─────────────────────────────┤
       │  Connect WebSocket           │  Connect WebSocket           │
       ├─────────────────────────────►│◄─────────────────────────────┤
       │                              │                              │
       │         5-gate auth ─────── pair sockets ────── spawn tmux  │
       │                              │                              │
       │  Keystrokes ────────────────►│─────────────────────────────►│ tmux send-keys
       │◄──────────────── output ─────│◄─────────────────────────────│ tmux capture-pane
       │  Resize ────────────────────►│─────────────────────────────►│ tmux resize-window
       │                              │                              │
       │  Ctrl+] disconnect           │          kill tmux session   │
       │  ────────────────────────────│──────────────────────────────│
       │                              │  update audit log            │  save recording
```

## Deployment Modes

| Mode | Server | Auth | Use Case |
| --- | --- | --- | --- |
| **Standalone** | Own Fastify server, own CA, port 9494 | API key (admin) + mTLS (agents) | SSH alternative on LAN or with port forwarding |
| **Tunnel** | Own Fastify server + Portlama tunnel | API key (admin) + ticket-based (agents via `@lamalibre/portlama-tickets`) | Standalone server where agents are behind NAT/firewalls |
| **Plugin** | Runs inside Portlama | Portlama mTLS certificates | Remote access through Portlama's relay |

## Quick Start

### Standalone Setup

```bash
# On the server machine (your Mac)
npx @lamalibre/create-shell

# On the remote machine (copy the join token from above)
npx @lamalibre/create-shell --join --server https://<server-ip>:9494 --token <token>

# Back on the server — enable and connect
shell enable <agent-label>
shell connect <agent-label>
```

See the [Quick Start guide](docs/00-introduction/quickstart.md) for details.

## Repository Structure

```
shell/
├── packages/
│   ├── shell-server/       # Fastify server (standalone + Portlama plugin)
│   ├── shell-agent/        # Agent daemon (tmux session manager)
│   ├── shell-cli/          # CLI tool
│   ├── shell-desktop/      # Tauri v2 desktop app (Svelte 5)
│   ├── create-shell/       # npx installer (zero deps, esbuild bundled)
│   └── shell-e2e-mcp/      # E2E test infrastructure (MCP server)
├── tests/
│   ├── e2e/               # Single-node E2E tests
│   └── e2e-multi/         # Multi-node integration tests
└── docs/                  # Documentation (see below)
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Server | Fastify 5, Zod validation, WebSocket (ws) |
| Agent | Node.js ESM, tmux CLI, execa |
| Desktop | Tauri v2, Svelte 5, Tailwind |
| CLI | @clack/prompts, picocolors |
| Certificates | node-forge (CA generation, mTLS) |
| Installer | esbuild bundled, zero runtime deps |
| State | JSON files (atomic temp → fsync → rename) |
| Monorepo | pnpm workspaces, Node.js 22+ |
| Target OS | macOS (launchd), Linux (systemd) |

## Development

```bash
pnpm install          # install all workspace dependencies
pnpm build            # build all packages
pnpm lint             # lint all packages
```

## Documentation

Full documentation is in the [`docs/`](docs/) directory:

### Getting Started

- **[What is Shell?](docs/00-introduction/what-is-shell.md)** — overview, use cases, and quick reference
- **[How It Works](docs/00-introduction/how-it-works.md)** — architecture walkthrough, data flows, and design decisions
- **[Quick Start](docs/00-introduction/quickstart.md)** — from zero to first session in 10 minutes

### Concepts

- **[Deployment Modes](docs/01-concepts/deployment-modes.md)** — standalone vs plugin mode comparison
- **[Security Model](docs/01-concepts/security-model.md)** — 5-gate auth chain, time windows, session recording
- **[tmux Sessions & Recording](docs/01-concepts/tmux-sessions.md)** — session lifecycle, output model, special key allowlist
- **[WebSocket Relay](docs/01-concepts/websocket-relay.md)** — connection pairing, message types, close codes

### Guides

- **[Standalone Setup](docs/02-guides/standalone-setup.md)** — server installation and service management
- **[Agent Enrollment](docs/02-guides/agent-enrollment.md)** — enrolling agents in both modes
- **[Desktop App](docs/02-guides/desktop-app.md)** — Tauri v2 graphical management interface
- **[CLI Usage](docs/02-guides/cli-usage.md)** — command-line tool reference
- **[Managing Policies](docs/02-guides/managing-policies.md)** — IP allowlists, command blocklists, policy CRUD

### Architecture

- **[System Overview](docs/03-architecture/overview.md)** — component roles, monorepo structure, data flows
- **[Shell Server](docs/03-architecture/shell-server.md)** — Fastify server, routes, libraries, certificates
- **[Shell Agent](docs/03-architecture/shell-agent.md)** — daemon lifecycle, tmux management, TLS
- **[State Management](docs/03-architecture/state-management.md)** — file formats, atomic writes, concurrency

### API Reference

- **[API Overview](docs/04-api-reference/overview.md)** — authentication, error format, endpoint summary
- **[Config & Policies API](docs/04-api-reference/config-policies.md)** — configuration and policy endpoints
- **[Agents & Sessions API](docs/04-api-reference/agents-sessions.md)** — agent management, enable/disable, audit log
- **[WebSocket Protocol](docs/04-api-reference/websocket-protocol.md)** — message format, sequence diagrams, close codes

### Reference

- **[Config Files](docs/05-reference/config-files.md)** — file locations, permissions, write patterns
- **[Glossary](docs/05-reference/glossary.md)** — term definitions

## Security Highlights

- **5-gate auth chain:** global toggle → agent cert valid → time window active → IP ACL → admin cert
- **Time-limited access:** 5–480 minutes, re-checked every 30 seconds during sessions
- **Session recording:** every session captured via `tmux pipe-pane`
- **Command blocklist:** 18 hard-blocked commands, 9 restricted prefixes (advisory)
- **Atomic file writes:** temp → fsync → rename for all state files
- **Special key allowlist:** only Enter, Escape, C-c, C-d, C-z, Tab, arrows, BSpace, DC, Home, End, PPage, NPage

## License

PolyForm Noncommercial 1.0.0. Copyright (c) 2025 Code Lama Software.
