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

See the [Quick Start guide](https://lamalibre.github.io/shell/00-introduction/quickstart) for details.

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

Full documentation is available at **[lamalibre.github.io/shell](https://lamalibre.github.io/shell/)**.

### Getting Started

- **[What is Shell?](https://lamalibre.github.io/shell/00-introduction/what-is-shell)** — overview, use cases, and quick reference
- **[How It Works](https://lamalibre.github.io/shell/00-introduction/how-it-works)** — architecture walkthrough, data flows, and design decisions
- **[Quick Start](https://lamalibre.github.io/shell/00-introduction/quickstart)** — from zero to first session in 10 minutes

### Concepts

- **[Deployment Modes](https://lamalibre.github.io/shell/01-concepts/deployment-modes)** — standalone vs plugin mode comparison
- **[Security Model](https://lamalibre.github.io/shell/01-concepts/security-model)** — 5-gate auth chain, time windows, session recording
- **[tmux Sessions & Recording](https://lamalibre.github.io/shell/01-concepts/tmux-sessions)** — session lifecycle, output model, special key allowlist
- **[WebSocket Relay](https://lamalibre.github.io/shell/01-concepts/websocket-relay)** — connection pairing, message types, close codes

### Guides

- **[Standalone Setup](https://lamalibre.github.io/shell/02-guides/standalone-setup)** — server installation and service management
- **[Agent Enrollment](https://lamalibre.github.io/shell/02-guides/agent-enrollment)** — enrolling agents in both modes
- **[Desktop App](https://lamalibre.github.io/shell/02-guides/desktop-app)** — Tauri v2 graphical management interface
- **[CLI Usage](https://lamalibre.github.io/shell/02-guides/cli-usage)** — command-line tool reference
- **[Managing Policies](https://lamalibre.github.io/shell/02-guides/managing-policies)** — IP allowlists, command blocklists, policy CRUD

### Architecture

- **[System Overview](https://lamalibre.github.io/shell/03-architecture/overview)** — component roles, monorepo structure, data flows
- **[Shell Server](https://lamalibre.github.io/shell/03-architecture/shell-server)** — Fastify server, routes, libraries, certificates
- **[Shell Agent](https://lamalibre.github.io/shell/03-architecture/shell-agent)** — daemon lifecycle, tmux management, TLS
- **[State Management](https://lamalibre.github.io/shell/03-architecture/state-management)** — file formats, atomic writes, concurrency

### API Reference

- **[API Overview](https://lamalibre.github.io/shell/04-api-reference/overview)** — authentication, error format, endpoint summary
- **[Config & Policies API](https://lamalibre.github.io/shell/04-api-reference/config-policies)** — configuration and policy endpoints
- **[Agents & Sessions API](https://lamalibre.github.io/shell/04-api-reference/agents-sessions)** — agent management, enable/disable, audit log
- **[WebSocket Protocol](https://lamalibre.github.io/shell/04-api-reference/websocket-protocol)** — message format, sequence diagrams, close codes

### Reference

- **[Config Files](https://lamalibre.github.io/shell/05-reference/config-files)** — file locations, permissions, write patterns
- **[Glossary](https://lamalibre.github.io/shell/05-reference/glossary)** — term definitions

## Security Highlights

- **5-gate auth chain:** global toggle → agent cert valid → time window active → IP ACL → admin cert
- **Time-limited access:** 5–480 minutes, re-checked every 30 seconds during sessions
- **Session recording:** every session captured via `tmux pipe-pane`
- **Command blocklist:** 18 hard-blocked commands, 9 restricted prefixes (advisory)
- **Atomic file writes:** temp → fsync → rename for all state files
- **Special key allowlist:** only Enter, Escape, C-c, C-d, C-z, Tab, arrows, BSpace, DC, Home, End, PPage, NPage

## License

PolyForm Noncommercial 1.0.0. Copyright (c) 2025 Code Lama Software.
