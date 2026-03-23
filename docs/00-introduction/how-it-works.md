# How It Works

> Shell connects an admin terminal to a remote machine's tmux session through a WebSocket relay, with time-limited access, policy-based controls, and session recording.

## In Plain English

Picture a phone switchboard from the early days of telephony. Two callers dial into the switchboard, and the operator connects their lines. Neither caller needs to know the other's phone number — they just need to reach the switchboard.

That is Shell in a nutshell:

- **Your terminal** (CLI or desktop app) is one caller. It dials the relay asking to connect to a specific machine.
- **The remote machine** (agent) is the other caller. It has been polling the relay, waiting for someone to call.
- **The relay** (shell server) is the switchboard operator. It verifies both callers' credentials, checks that access is currently allowed, and connects their lines.

Once connected, everything you type goes through the relay to tmux on the remote machine. Everything tmux displays comes back through the relay to your screen. The relay never looks at the terminal data — it just passes bytes in both directions.

The session has a built-in expiration. When you enabled access for the remote machine, you set a time window — maybe 30 minutes. When that window expires, the relay disconnects both sides. The session was recorded the entire time, so there is a complete audit trail on the agent machine.

### Why not just use SSH?

SSH is excellent, but Shell solves cases where SSH is impractical:

- **No inbound ports** — the agent connects outbound to the relay; no firewall changes needed on the remote machine
- **Centralized access control** — enable/disable access from a single dashboard; no managing SSH keys across machines
- **Time-limited access** — access expires automatically; no need to remember to revoke credentials
- **Session recording** — built-in audit trail; SSH requires separate tooling for session capture
- **Works through Portlama** — if you already use Portlama for tunneling, Shell adds terminal access with no extra infrastructure

## For Users

### The Big Picture

Shell has three participants that work together:

**1. The Shell Server (relay)**

The server sits between you and the remote machine. In standalone mode, it runs on your Mac or a VPS. In plugin mode, it runs inside Portlama on your existing relay server.

The server does four things:
- Manages agent enrollment and certificates
- Stores policies (IP allowlists, command blocklists, time limits)
- Relays WebSocket traffic between admin and agent
- Maintains an audit log of all sessions

**2. The Agent (remote machine)**

The agent is a daemon running on the machine you want to access. It:
- Polls the server every 10 seconds to check if shell access is enabled
- When an admin connects, spawns a tmux session
- Captures terminal output every 100ms and sends it through the relay
- Records the session to disk via `tmux pipe-pane`
- Enforces an advisory command blocklist

**3. The Admin (you)**

You use the CLI, desktop app, or Portlama panel to:
- Enable shell access for a specific agent (with a time window and policy)
- Connect to an interactive terminal session
- View session history and audit logs
- Manage policies and agent enrollment

### Data Flow: How a Session Works

```
1. Admin enables shell for agent "office-mac" (30 minutes)
   └─ Server sets shellEnabledUntil on agent record

2. Agent's 10-second poll detects access is enabled
   └─ Agent connects WebSocket to server: /api/shell/agent/office-mac
   └─ Agent sends { type: "agent-ready", label: "office-mac" }
   └─ Agent waits for admin

3. Admin connects: /api/shell/connect/office-mac
   └─ Server runs 5-gate authentication:
      Gate 1: Caller has admin role?
      Gate 2: Global shell enabled?
      Gate 3: Agent cert valid and not revoked?
      Gate 4: shellEnabledUntil still in the future?
      Gate 5: Admin's IP passes policy ACL?
   └─ Server creates audit log entry (status: pending)

4. Server pairs admin and agent WebSockets
   └─ Transparent bidirectional relay begins
   └─ Agent spawns tmux session (120x40, with recording)
   └─ Agent sends { type: "session-started", sessionId: "..." }

5. Interactive session
   └─ Admin types → { type: "input", data: "ls\n" } → relay → agent → tmux send-keys
   └─ tmux output changes → agent captures pane → { type: "output", data: "..." } → relay → admin
   └─ Admin resizes terminal → { type: "resize", cols: 180, rows: 50 } → relay → agent → tmux resize

6. Every 30 seconds, server checks if time window has expired
   └─ If expired → sends "time-window-expired" → closes both WebSockets
   └─ Agent kills tmux session

7. Session ends (disconnect, timeout, or time window expiry)
   └─ Server updates audit log (endedAt, duration)
   └─ Recording remains on agent at ~/.shell-agent/recordings/<sessionId>.log
```

### The Admin Experience

When you connect from a terminal:

```
$ shell connect office-mac
  Connecting to office-mac...
  Session started. Press Ctrl+] to disconnect.

  shell:/home/user$ ls
  Documents  Downloads  projects
  shell:/home/user$ _
```

Your terminal enters raw mode — every keystroke goes directly to the remote tmux session. The screen clears and shows the remote terminal's full content. When the remote output changes, the screen redraws. It feels like sitting at the remote machine.

Press `Ctrl+]` to disconnect. The session ends, the tmux process is killed, and the recording is saved.

### Component Map

```
┌──────────────────────────────────────────────────────────────────────┐
│  Server Machine (Mac / VPS / Portlama)                               │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Shell Server (Fastify, port 9494)                             │  │
│  │                                                                │  │
│  │  REST API                          WebSocket Relay             │  │
│  │  ├─ /api/shell/config              ├─ /api/shell/connect/:l   │  │
│  │  ├─ /api/shell/policies            └─ /api/shell/agent/:l     │  │
│  │  ├─ /api/shell/enable/:label                                  │  │
│  │  ├─ /api/shell/agent-status        Certificate Management     │  │
│  │  ├─ /api/shell/sessions            ├─ CA generation           │  │
│  │  └─ /api/shell/agents              ├─ CSR signing             │  │
│  │                                    └─ Token enrollment        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  State: ~/.shell/                                                    │
│  ├─ shell-config.json (policies, enabled flag)                       │
│  ├─ shell-sessions.json (audit log, last 500)                        │
│  ├─ agents.json (agent registry)                                     │
│  ├─ ca.crt + ca.key (root CA)                                        │
│  └─ api-key (32-byte hex)                                            │
└──────────────────────────────────────────────────────────────────────┘
         ▲                           ▲
         │ wss:// (admin)            │ wss:// (agent)
         │                           │
┌────────┴────────┐     ┌───────────┴──────────────────────────────────┐
│  Admin Machine   │     │  Remote Machine (macOS / Linux)              │
│                  │     │                                              │
│  shell-cli       │     │  shell-agent serve                           │
│  or              │     │  ├─ Polls /api/shell/agent-status (10s)      │
│  shell-desktop   │     │  ├─ Spawns tmux session on connect           │
│  or              │     │  ├─ Captures pane output (100ms)             │
│  Portlama panel  │     │  ├─ Records via tmux pipe-pane               │
│                  │     │  └─ Enforces command blocklist                │
│                  │     │                                              │
│                  │     │  State: ~/.shell-agent/                       │
│                  │     │  ├─ agent.json (config)                       │
│                  │     │  ├─ cert.pem + key.pem (mTLS)                 │
│                  │     │  ├─ shell-blocklist.json                      │
│                  │     │  ├─ shell-history.log                         │
│                  │     │  └─ recordings/<uuid>.log                     │
└─────────────────┘     └──────────────────────────────────────────────┘
```

## For Developers

### Architecture Philosophy

Shell follows three core principles:

1. **The relay is transparent.** The server never interprets terminal data. It pairs two WebSockets and forwards every frame as-is. All terminal intelligence lives in the agent (tmux) and the client (xterm rendering). This keeps the relay simple and stateless during active sessions.

2. **Security is layered, not perimeter-based.** Five independent authentication gates must all pass before a session starts. Time windows expire automatically. Sessions are recorded. The command blocklist is explicitly advisory — real security comes from the auth chain, time limits, and audit trail.

3. **No database.** State is stored in JSON files with atomic writes (temp → fsync → rename). At this scale — a handful of agents, one admin — a database adds complexity for no benefit. A promise-chain mutex serializes concurrent writes to prevent races.

### Technology Choices Explained

| Choice | Why | Alternatives Considered |
| --- | --- | --- |
| tmux for sessions | Handles terminal multiplexing, resize, scrollback; `capture-pane` gives clean output snapshots; `pipe-pane` gives free session recording | screen (less features), direct PTY (complex resize/capture) |
| WebSocket for relay | Full-duplex, works through firewalls and proxies, standard protocol | Raw TCP (blocked by firewalls), SSH tunnels (need open ports) |
| node-forge for CA | Pure JavaScript PKI, no native dependencies, generates CA + signs CSRs | openssl CLI (fragile parsing), mkcert (external binary) |
| Zod for validation | Runtime type-safe schema validation, good TypeScript inference, composable | joi (less TypeScript), ajv (JSON Schema, less ergonomic) |
| execa for shell commands | Array arguments (no injection), TypeScript types, streaming support | child_process (string concatenation risk), shelljs (sync) |
| Fastify for server | Fast, schema-first validation, native WebSocket via @fastify/websocket, plugin system for dual-mode | Express (slower, no native WS), Hono (less ecosystem) |
| JSON files for state | Simple, no daemon, atomic writes, crash-safe | SQLite (adds dependency), PostgreSQL (overkill at this scale) |
| Tauri for desktop | Native performance, small binary, Rust backend for subprocess management | Electron (large binary, high RAM), web-only (no terminal spawn) |

### Related Documentation

- [Deployment Modes](../01-concepts/deployment-modes.md) — standalone vs plugin mode in detail
- [Security Model](../01-concepts/security-model.md) — the 5-gate authentication chain
- [tmux Sessions](../01-concepts/tmux-sessions.md) — session lifecycle and recording
- [WebSocket Relay](../01-concepts/websocket-relay.md) — connection pairing and message flow
- [System Overview](../03-architecture/overview.md) — monorepo structure and component roles
- [Glossary](../05-reference/glossary.md) — term definitions
