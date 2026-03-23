# Shell Agent

> The shell agent is a daemon that runs on remote machines, polls the server for access status, spawns tmux sessions on demand, and relays terminal I/O through the WebSocket connection.

## Daemon Lifecycle

### Standalone / Plugin Mode

```
shell-agent serve
  │
  ├── Verify tmux is installed
  ├── Install shell-wrapper.sh to ~/.shell-agent/
  ├── Load TLS credentials (PEM or P12)
  │
  └── Main loop:
      ├── Poll GET /api/shell/agent-status (every 10s)
      │   └── If not enabled → sleep 10s → poll again
      │
      ├── Enabled → write blocklist from policy → connect WebSocket
      │   └── /api/shell/agent/<label>
      │   └── Send { type: "agent-ready", label }
      │   └── Wait for admin
      │
      ├── Admin connected → spawn tmux → start output poller
      │   └── tmux new-session (120x40, shell-wrapper.sh)
      │   └── tmux pipe-pane (recording)
      │   └── Poll capture-pane every 100ms
      │
      ├── Session active
      │   ├── input → tmux send-keys -l
      │   ├── special-key → tmux send-keys (allowlist validated)
      │   ├── resize → tmux resize-window
      │   └── output change → send { type: "output", data }
      │
      ├── Session ends
      │   ├── admin-disconnected → kill tmux → stop poller
      │   ├── time-window-expired → kill tmux → close WebSocket
      │   └── error → kill tmux → reconnect after 5s
      │
      └── Wait 5s → reconnect to relay (repeat)
```

### Tunnel Mode

In tunnel mode the agent does not poll the shell-server directly. Instead it uses the `@lamalibre/portlama-tickets` SDK to poll the Portlama panel's ticket inbox and connects via ticket-based auth:

```
shell-agent serve (mode: tunnel)
  │
  ├── Verify tmux is installed
  ├── Install shell-wrapper.sh to ~/.shell-agent/
  ├── Initialize TicketClient with P12 mTLS credentials
  │   └── createTicketDispatcher({ certs: { p12Path, p12Password } })
  │   └── new TicketClient({ panelUrl, dispatcher, logger })
  │
  └── Main loop:
      ├── Poll ticket inbox via client.fetchInbox() (every 3s)
      │   └── Look for ticket with scope "shell:connect"
      │   └── If none found → sleep 3s → poll again
      │
      ├── Ticket found → validate via client.validateTicket(id)
      │   └── Report session creation: client.reportSessionCreation(id)
      │
      ├── Connect WebSocket to /api/shell/agent-ticket/<label>
      │   └── Send { type: "ticket", ticketId } as first message
      │   └── Wait for { type: "ticket-accepted", sessionToken, commandBlocklist }
      │   └── Write command blocklist if present
      │   └── Start panel heartbeat (60s interval via client.sendSessionHeartbeat)
      │   └── Send { type: "agent-ready", label }
      │
      ├── Session active (same as standalone/plugin)
      │   └── Panel heartbeat checks authorization every 60s
      │   └── If panel says not authorized → close WebSocket
      │
      ├── Session ends (same as standalone/plugin)
      │
      └── Wait 5s → reconnect (repeat)
```

## Message Handling

When the agent receives a message from the server:

| Message | Action |
| --- | --- |
| `admin-connected` | Spawn tmux session, start 100ms output poller |
| `input` | `tmux send-keys -l "<data>"` (literal text) |
| `special-key` | Validate against allowlist, `tmux send-keys <key>` |
| `resize` | Validate 1-500, `tmux resize-window -x <cols> -y <rows>` |
| `admin-disconnected` | Kill tmux session, stop output poller, wait for reconnect |
| `time-window-expired` | Kill tmux session, close WebSocket (code 1000) |

## TLS Credential Loading

### Standalone Mode

Reads PEM files directly from `~/.shell-agent/`:
- `cert.pem` — client certificate
- `key.pem` — private key
- `ca.crt` — server CA (if present, enables server verification)

### Plugin Mode (P12)

Extracts credentials from a P12 bundle via `openssl pkcs12`:
1. Extract client cert: `openssl pkcs12 -clcerts -nokeys`
2. Extract private key: `openssl pkcs12 -nocerts -nodes`
3. Extract CA chain: `openssl pkcs12 -cacerts -nokeys`

- Password passed via `SHELL_AGENT_P12_PASS` environment variable (never in process args)
- Temporary PEM files written to `~/.shell-agent/.pem/` (mode `0700`)
- Cleanup function deletes extracted files after use
- Always `rejectUnauthorized: false` in plugin mode (self-signed server cert)

### Tunnel Mode

No TLS credentials from the shell-server's CA. Instead, the agent uses P12 credentials from Portlama for panel API calls via the `@lamalibre/portlama-tickets` SDK. The SDK handles P12 extraction internally via `createTicketDispatcher()`. WebSocket connections to the shell-server use public HTTPS (`rejectUnauthorized: true`) — authentication is ticket-based, not certificate-based.

## Enrollment

Standalone enrollment (`shell-agent enroll`):

1. Generate RSA 2048 keypair via node-forge
2. Create CSR with `CN=agent:<label>`
3. POST to `/api/shell/enroll` with `{ token, csr }`
4. Server validates token, signs CSR with CA
5. Server returns `{ cert, ca, label }`
6. Agent saves atomically:
   - `cert.pem` (mode `0644`)
   - `key.pem` (mode `0600`)
   - `ca.crt` (mode `0644`)
   - `agent.json` (mode `0600`)

## Interactive Client

The agent also functions as an admin client (`shell-agent connect <label>`):

1. Loads TLS credentials
2. Connects WebSocket to `/api/shell/connect/<label>` (admin endpoint)
3. Sets stdin to raw mode
4. Sends keystrokes as `{ type: "input", data }`
5. Receives output as `{ type: "output", data }` — clears screen, writes full pane
6. Handles resize events → `{ type: "resize", cols, rows }`
7. Exit on `Ctrl+]` (byte `0x1d`)

## Platform Support

| Platform | Status | Service |
| --- | --- | --- |
| macOS (darwin) | Supported | launchd plist |
| Linux | Supported | systemd user unit |
| Windows | Not supported | Exits with error |

## CLI Commands

```
shell-agent serve                                    # Start daemon
shell-agent connect <label>                          # Interactive client
shell-agent enroll --server <url> --token <token>    # Enrollment
shell-agent log [label] [--download <sessionId>]     # Session logs
shell-agent --version                                # Version
```

## File Layout

```
~/.shell-agent/                    # 0700
├── agent.json                     # Config (mode, serverUrl, label) — 0600
├── cert.pem                       # Client certificate — 0644
├── key.pem                        # Private key — 0600
├── ca.crt                         # Server CA — 0644
├── shell-wrapper.sh               # Command filter — 0755
├── shell-blocklist.json           # Blocklist from policy — 0600
├── shell-history.log              # Command log (append-only)
├── recordings/                    # Session recordings
│   └── <uuid>.log                 # One per session
└── .pem/                          # Temporary P12 extraction — 0700
    ├── client-cert.pem            # Extracted cert — 0644
    └── client-key.pem             # Extracted key — 0600
```

## Source Files

| File | Purpose |
| --- | --- |
| `src/cli.ts` | CLI entry point, command dispatch |
| `src/serve.ts` | Daemon main loop (poll, connect, reconnect) |
| `src/relay.ts` | WebSocket handler, message dispatch, output polling; `connectRelayWithTicket()` for tunnel mode |
| `src/tmux.ts` | tmux spawn, capture, send-keys, resize, kill |
| `src/connect.ts` | Interactive client mode |
| `src/enroll.ts` | Agent enrollment (CSR generation, cert saving) |
| `src/lib/tls.ts` | TLS credential loading (PEM + P12 extraction) |
| `src/lib/panel-api.ts` | Console logger adapter for `@lamalibre/portlama-tickets` SDK (`createConsoleTicketLogger()`) |
| `src/log.ts` | Session log viewer and download |
| `src/lib/shell-wrapper.sh` | Command blocklist wrapper (copied to agent dir) |

### SDK Re-exports

The shell-agent package re-exports key types from `@lamalibre/portlama-tickets` for consumers:
- `TicketClient` — panel API client for ticket operations
- `createTicketDispatcher` — creates mTLS dispatcher from P12 credentials
- `TicketInboxEntry`, `TicketClientOptions`, `TicketLogger` — types

## Related Documentation

- [Shell Server](shell-server.md) — the relay side
- [tmux Sessions](../01-concepts/tmux-sessions.md) — session lifecycle details
- [Agent Enrollment](../02-guides/agent-enrollment.md) — enrollment guide
- [State Management](state-management.md) — file formats
