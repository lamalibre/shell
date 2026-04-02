# System Architecture Overview

> Shell is a relay-based remote terminal system where a server pairs admin and agent WebSocket connections to provide secure, time-limited shell access via tmux.

## In Plain English

Shell has three main pieces:

1. **The Shell Server** — a Fastify application that manages certificates, policies, and agent registry, and relays WebSocket traffic between admin and agent connections. In standalone mode it runs on its own. In plugin mode it runs inside Portlama.

2. **The Shell Agent** — a daemon on the remote machine that polls the server, spawns tmux sessions on demand, and relays terminal I/O through the WebSocket connection.

3. **The Admin Tools** — a CLI, a desktop app, or the Portlama panel that let you manage agents, enable access, and connect to terminal sessions.

These three pieces interact through a clear lifecycle: the admin enrolls an agent, enables shell access with a time window, connects via WebSocket, and the server pairs the connection with the agent's WebSocket to create a transparent terminal relay.

## System Diagram

```
                        ┌──────────────────────────────────────────────────┐
                        │  Server Machine (Mac / VPS / Portlama)           │
                        │                                                  │
  Admin                 │  ┌────────────────────────────────────────────┐  │
  (CLI / Desktop)       │  │  Shell Server (Fastify)                    │  │
       │                │  │                                            │  │
       │  wss://:9494   │  │  REST API           WebSocket Relay        │  │
       ├───────────────►│  │  ├─ config           ├─ /connect/:label   │  │
       │                │  │  ├─ policies          ├─ /agent/:label     │  │
       │                │  │  │                    └─ /agent-ticket/:label│ │
       │                │  │  ├─ enable/:label                         │  │
       │                │  │  ├─ agent-status      Certificate Mgmt    │  │
       │                │  │  ├─ sessions          ├─ CA generation     │  │
       │                │  │  ├─ agents            ├─ CSR signing       │  │
       │                │  │  └─ recordings        └─ Token enrollment  │  │
       │                │  └────────────────────────────────────────────┘  │
       │                │                                                  │
       │                │  State: ~/.shell/                                │
       │                │  ├─ shell-config.json    ├─ ca.crt + ca.key     │
       │                │  ├─ shell-sessions.json  ├─ server.crt + .key   │
       │                │  ├─ agents.json          └─ api-key             │
       │                │  └─ tunnel.json                                 │
       │                └──────────────────────────────────────────────────┘
       │                            ▲
       │                            │  wss:// (agent)
       │                            │
       │                ┌───────────┴──────────────────────────────────────┐
       │                │  Remote Machine (macOS / Linux)                   │
       │                │                                                  │
       │                │  shell-agent serve                                │
       │                │  ├── Poll /api/shell/agent-status (10s)          │
       │                │  ├── Connect WebSocket when enabled              │
       │                │  ├── Spawn tmux session on admin connect         │
       │                │  ├── Capture pane output (100ms polling)         │
       │                │  ├── Record session (tmux pipe-pane)             │
       │                │  └── Enforce command blocklist (advisory)        │
       │                │                                                  │
       │                │  State: ~/.shell-agent/                           │
       │                │  ├─ agent.json           ├─ cert.pem + key.pem  │
       │                │  ├─ shell-blocklist.json  ├─ ca.crt             │
       │                │  ├─ shell-history.log    └─ recordings/          │
       │                │  └─ shell-wrapper.sh                             │
       │                └──────────────────────────────────────────────────┘
       │
┌──────┴───────────────────────────┐
│  Admin Machine                    │
│                                  │
│  shell-cli                       │
│  ├── connect <label>             │
│  ├── enable / disable <label>    │
│  ├── sessions / recordings       │
│  ├── config / policies           │
│  └── ~/.shell-cli/config.json    │
│                                  │
│  shell-desktop (Tauri v2)        │
│  ├── Delegates to ShellApp       │
│  │   from shell-panel            │
│  ├── Agents tab (enable/connect) │
│  ├── Policies tab (CRUD)         │
│  ├── Sessions tab (audit log)    │
│  ├── Recordings tab (playback)   │
│  ├── Settings tab (preferences)  │
│  └── ~/.shell-desktop/config.json│
└──────────────────────────────────┘
```

## Component Roles

| Component | Technology | Role |
| --- | --- | --- |
| **Shell Server** | Fastify 5, node-forge, Zod | WebSocket relay, REST API, certificate authority, agent registry |
| **Shell Agent** | Node.js ESM, tmux, execa | Terminal session manager, output capture, session recording |
| **Shell CLI** | @clack/prompts, picocolors | Admin command-line interface |
| **Shell Panel** | Svelte 5, Tailwind v4 | Shared UI component library (pages, components, API client) |
| **Shell Desktop** | Tauri v2, Svelte 5, Tailwind v4 | Admin graphical interface (imports pages from shell-panel) |
| **Create Shell** | esbuild bundled, zero deps | One-command installer for server and agent |
| **Shell E2E MCP** | MCP SDK, Multipass | E2E test infrastructure (VM provisioning, test orchestration) |

## Monorepo Structure

```
shell/
├── packages/
│   ├── shell-server/              ← Fastify relay + REST API
│   │   └── src/
│   │       ├── standalone.ts      ← Own CA, API key, HTTPS server
│   │       ├── plugin.ts          ← Portlama integration (fastify-plugin)
│   │       ├── relay.ts           ← WebSocket pairing + relay
│   │       ├── routes/            ← REST endpoints (config, policies, enable, sessions, agents, files)
│   │       ├── lib/               ← Business logic (shell, registry, IP matching, file utils)
│   │       ├── cert/              ← CA generation, CSR signing, enrollment tokens
│   │       └── schemas.ts         ← Zod validation schemas
│   │
│   ├── shell-agent/               ← Agent daemon
│   │   └── src/
│   │       ├── cli.ts             ← CLI entry (serve, connect, enroll, log)
│   │       ├── serve.ts           ← Daemon loop (poll, connect, reconnect)
│   │       ├── relay.ts           ← WebSocket handler, message dispatch
│   │       ├── tmux.ts            ← tmux spawn, capture, send-keys, resize
│   │       ├── connect.ts         ← Interactive client mode
│   │       ├── enroll.ts          ← Agent enrollment (CSR → cert)
│   │       ├── log.ts             ← Session log viewer
│   │       └── lib/
│   │           ├── tls.ts         ← TLS credential loading (PEM + P12)
│   │           ├── config.ts      ← Agent configuration
│   │           ├── platform.ts    ← Platform detection
│   │           ├── api.ts         ← API client helpers
│   │           └── panel-api.ts   ← Console logger adapter for portlama-tickets SDK
│   │
│   ├── shell-cli/                 ← Admin CLI
│   │   └── src/
│   │       ├── cli.ts             ← Command dispatch
│   │       ├── commands/          ← connect, enable, disable, sessions, recordings, config, policies
│   │       └── lib/               ← API client, config loader
│   │
│   ├── shell-panel/               ← Shared Svelte 5 UI component library
│   │   └── src/
│   │       ├── pages/             ← Agents, Policies, Sessions, Recordings, Settings
│   │       ├── components/        ← Reusable UI components
│   │       └── lib/               ← API client helpers
│   │
│   ├── shell-desktop/             ← Tauri v2 desktop app (imports pages from shell-panel)
│   │   ├── src/                   ← Svelte 5 frontend (app shell, routing)
│   │   └── src-tauri/src/         ← Rust backend (Tauri commands, curl wrapper, config)
│   │
│   ├── create-shell/              ← npx installer
│   │   └── src/lib/
│   │       ├── standalone-setup.ts ← Server + agent setup
│   │       ├── agent-setup.ts     ← Agent enrollment
│   │       ├── service.ts         ← launchd / systemd generation
│   │       └── detect.ts          ← Platform + tmux detection
│   │
│   └── shell-e2e-mcp/            ← MCP server for E2E tests
│       └── src/
│           ├── tools/             ← VM, snapshot, provision, test tools
│           └── lib/               ← State, logging, Multipass interaction
│
├── tests/
│   └── e2e/                       ← Bash-based E2E test scripts
│       ├── helpers.sh             ← Assertion functions, API helpers
│       ├── run-all.sh             ← Test runner
│       ├── vm/                    ← VM setup scripts (host + agent)
│       └── 01-*.sh through 09-*.sh
│
└── docs/                          ← This documentation
```

## Data Flows

### Enrollment (Standalone)

```
1. Admin creates join token
   └── POST /api/shell/tokens → { token, label, expiresAt }

2. Agent generates keypair + CSR
   └── RSA 2048, CN=agent:<label>

3. Agent sends CSR to server
   └── POST /api/shell/enroll { token, csr }
   └── Server validates token (timing-safe), signs CSR with CA
   └── Returns { cert, ca, label }

4. Agent stores credentials
   └── ~/.shell-agent/cert.pem, key.pem, ca.crt, agent.json
```

### Session Lifecycle

```
1. Admin enables access
   └── POST /api/shell/enable/office-mac { durationMinutes: 30, policyId: "default" }
   └── Server sets agent.shellEnabledUntil = now + 30min

2. Agent detects access
   └── GET /api/shell/agent-status → { shellEnabled: true, commandBlocklist: {...} }
   └── Agent writes blocklist, connects WebSocket

3. Admin connects
   └── WebSocket /api/shell/connect/office-mac
   └── 5-gate auth → audit log → wait for agent (or pair immediately)

4. Relay active
   └── Admin keystrokes → server → agent → tmux send-keys
   └── tmux output → agent captures → server → admin screen
   └── Time-window checked every 30s

5. Session ends
   └── Disconnect / timeout / time-window expiry
   └── Audit log updated, recording saved on agent
```

## Shared Dependencies

| Package | Purpose |
| --- | --- |
| `@lamalibre/portlama-tickets` | Agent-to-agent authorization SDK — used by shell-server (TicketInstanceManager, TicketStore, SessionStore, PanelTicketMap) and shell-agent (TicketClient, createTicketDispatcher) for tunnel-mode ticket auth and panel communication |

## Design Decisions

### Why WebSocket relay instead of direct connection?

The agent connects outbound to the relay — no inbound ports needed on the remote machine. This works through NAT, firewalls, and corporate networks. The relay adds latency (~1ms per hop) but eliminates the need for port forwarding or VPN tunnels.

### Why tmux instead of direct PTY?

tmux provides `capture-pane` (clean screen snapshots), `pipe-pane` (session recording), `resize-window` (resize support), and `send-keys` (input injection) out of the box. Implementing these with raw PTYs would require reimplementing most of what tmux already provides.

### Why full-screen refresh instead of differential output?

Sending the complete pane content on each change is simpler and more robust than streaming raw escape sequences. It handles full-screen apps (vim, htop) correctly because the client always has the complete terminal state. The bandwidth cost is acceptable — a typical 120x40 terminal is ~5KB per update.

### Why JSON files instead of a database?

At this scale (handful of agents, one admin), a database adds a dependency and operational complexity for no benefit. JSON files with atomic writes provide crash-safe persistence. The promise-chain mutex serializes concurrent writes.

### Why time-limited access instead of permanent enable?

Permanent access creates a security risk — if forgotten, an agent remains accessible indefinitely. Time-limited windows force conscious decisions and automatic cleanup. The maximum duration is 8 hours, covering a long work session without leaving permanent access.

## Key Files

| File | Role |
| --- | --- |
| `~/.shell/shell-config.json` | Global config (enabled flag, policies, default policy) |
| `~/.shell/shell-sessions.json` | Session audit log (last 500 entries) |
| `~/.shell/agents.json` | Agent registry (labels, certs, shell fields) |
| `~/.shell/ca.crt` + `ca.key` | Root CA (10-year validity) |
| `~/.shell/api-key` | Admin API key (32-byte hex) |
| `~/.shell/tunnel.json` | Tunnel mode config (fqdn, panel URL, P12 credentials) |
| `~/.shell-agent/agent.json` | Agent configuration |
| `~/.shell-agent/cert.pem` + `key.pem` | Agent mTLS credentials |
| `~/.shell-agent/shell-blocklist.json` | Command blocklist (synced from policy) |
| `~/.shell-agent/recordings/` | Session recordings |

## Related Documentation

- [Shell Server](shell-server.md) — server architecture in detail
- [Shell Agent](shell-agent.md) — agent daemon internals
- [State Management](state-management.md) — file formats and concurrency
- [Deployment Modes](../01-concepts/deployment-modes.md) — standalone vs plugin
