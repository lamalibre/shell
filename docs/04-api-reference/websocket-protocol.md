# WebSocket Protocol

> The WebSocket protocol defines the JSON message format exchanged between admin, server, and agent during terminal relay sessions.

## Connection Endpoints

### `WS /api/shell/connect/:label` — Admin

Opens an admin WebSocket connection requesting a terminal session with the specified agent.

**Auth:** Admin role (API key or admin certificate)

**Sequence:**
1. Server runs 5-gate authentication chain
2. If agent is already waiting → pair immediately
3. If agent is not waiting → admin waits up to 30 seconds
4. On timeout → close with code `4408`
5. On pairing → transparent bidirectional relay

### `WS /api/shell/agent/:label` — Agent

Opens an agent WebSocket connection offering a terminal session.

**Auth:** Agent role (certificate with `CN=agent:<label>`)

**Validation:**
- Global shell must be enabled
- Certificate label must match URL parameter
- `shellEnabledUntil` must be in the future
- No active session for this label (code `4409` if duplicate)

**Sequence:**
1. If admin is already waiting → pair immediately
2. If admin is not waiting → agent waits indefinitely
3. On pairing → receive `admin-connected`, spawn tmux session

### `WS /api/shell/agent-ticket/:label` — Agent (Tunnel Mode)

Opens an agent WebSocket connection using ticket-based authentication instead of mTLS.

**Auth:** Ticket handshake (first WebSocket message must be `{ type: "ticket", ticketId: "<id>" }`)

**Validation:**
- Ticket must be valid and not expired (5s handshake timeout)
- Ticket label must match URL parameter
- Global shell must be enabled
- `shellEnabledUntil` must be in the future
- No active session for this label (code `4409` if duplicate)

**Sequence:**
1. Agent connects (no mTLS preHandler)
2. Agent sends ticket message within 5 seconds
3. Server validates ticket, issues session token
4. Server sends `{ type: "ticket-accepted", sessionToken, commandBlocklist }`
5. Normal agent connection flow continues (same as `/agent/:label`)

## Message Format

All messages are JSON objects with a `type` field:

```json
{ "type": "<message-type>", ...payload }
```

## Server → Admin Messages

### `waiting`

Admin connected, agent not yet paired.

```json
{ "type": "waiting", "message": "Waiting for agent..." }
```

### `connected`

Agent connected, relay is now active.

```json
{ "type": "connected", "message": "Agent connected, shell relay active" }
```

### `error`

Authentication or server error. Connection will close.

```json
{ "type": "error", "message": "Shell access not enabled for this agent" }
```

### `time-window-expired`

The agent's `shellEnabledUntil` timestamp passed during an active session.

```json
{ "type": "time-window-expired" }
```

### `agent-disconnected`

The agent's WebSocket closed during an active session. Delivered as a WebSocket close frame (code `1000`, reason `"Agent disconnected"`), not a JSON message. The admin client should handle the `close` event.

## Server → Agent Messages

### `waiting`

Agent connected, admin not yet paired.

```json
{ "type": "waiting", "message": "Waiting for admin to connect..." }
```

### `admin-connected`

Admin connected, relay is now active. Agent should spawn tmux.

```json
{ "type": "admin-connected", "message": "Admin connected, shell relay active" }
```

### `error`

Authentication or conflict error.

```json
{ "type": "error", "message": "Session already active" }
```

### `time-window-expired`

Session time window expired. Agent should kill tmux and close.

```json
{ "type": "time-window-expired" }
```

### `admin-disconnected`

Admin's WebSocket closed. Agent should kill tmux and wait for reconnect. Delivered as a WebSocket close frame (code `1000`, reason `"Admin disconnected"`), not a JSON message. The agent should handle the `close` event.

## Agent → Server Messages (relayed to Admin)

### `agent-ready`

Agent connected and ready for pairing.

```json
{ "type": "agent-ready", "label": "office-ubuntu" }
```

### `session-started`

tmux session spawned, terminal I/O is active.

```json
{ "type": "session-started", "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

### `output`

Terminal content changed. Contains the full pane content (not a diff).

```json
{ "type": "output", "data": "shell:/home/user$ ls\nDocuments  Downloads  projects\nshell:/home/user$ " }
```

The `data` field contains the complete terminal buffer as captured by `tmux capture-pane -p -S -`. Sent only when the content differs from the previous capture (polled every 100ms).

## Admin → Server Messages (relayed to Agent)

### `input`

Text keystrokes to send to the terminal.

```json
{ "type": "input", "data": "ls -la\n" }
```

Sent to tmux via `tmux send-keys -l` (literal mode — no key name interpretation).

### `special-key`

A named key from the allowlist.

```json
{ "type": "special-key", "key": "Enter" }
```

**Allowed keys:**
```
Enter    Escape    C-c    C-d    C-z    Tab
Up       Down      Left   Right
BSpace   DC        Home   End    PPage  NPage
```

Any key not in this list is rejected by the agent. Sent to tmux via `tmux send-keys` (without `-l`, so key names are resolved).

### `resize`

Terminal window resized.

```json
{ "type": "resize", "cols": 180, "rows": 50 }
```

Both `cols` and `rows` must be integers between 1 and 500. Sent to tmux via `tmux resize-window`.

## Connection Sequence Diagram

```
Admin                          Server                         Agent
  │                              │                              │
  │  WS /connect/office-mac      │                              │
  ├─────────────────────────────►│                              │
  │                              │  5-gate auth                 │
  │                              │  Create audit entry          │
  │  { waiting }                 │                              │
  │◄─────────────────────────────┤                              │
  │                              │                              │
  │                              │  WS /agent/office-mac        │
  │                              │◄─────────────────────────────┤
  │                              │  Validate cert + time window │
  │                              │                              │
  │                              │  Pair WebSockets             │
  │  { connected }               │  { admin-connected }         │
  │◄─────────────────────────────┤─────────────────────────────►│
  │                              │                              │
  │                              │  { agent-ready }             │
  │  { agent-ready }             │◄─────────────────────────────┤
  │◄─────────────────────────────┤                              │
  │                              │                              │
  │                              │  Spawn tmux session          │
  │                              │  { session-started }         │
  │  { session-started }         │◄─────────────────────────────┤
  │◄─────────────────────────────┤                              │
  │                              │                              │
  │  { input, data: "ls\n" }     │                              │
  ├─────────────────────────────►│─────────────────────────────►│
  │                              │                              │  tmux send-keys
  │                              │                              │
  │                              │  { output, data: "..." }     │  tmux capture-pane
  │  { output, data: "..." }     │◄─────────────────────────────┤
  │◄─────────────────────────────┤                              │
  │                              │                              │
  │  ... interactive session ... │                              │
  │                              │                              │
  │                              │  Time window check (30s)     │
  │                              │  Still valid? Continue.       │
  │                              │                              │
  │  Ctrl+] (disconnect)         │                              │
  ├─ close 1000 ────────────────►│─ close 1000 ───────────────►│
  │                              │  Update audit log            │  Kill tmux
```

## Close Codes

| Code | Meaning | Triggered By |
| --- | --- | --- |
| `1000` | Normal closure | Either side disconnects |
| `1001` | Server shutting down | Server process exit |
| `1008` | Invalid agent label | Malformed label in URL |
| `1011` | Internal server error | Unexpected server error |
| `4400` | Global shell not enabled | Gate 2 failure |
| `4401` | Invalid ticket | Ticket handshake failed |
| `4403` | Auth failed | Gate 1, 3-5 failure, or time-window expiry during session |
| `4404` | Agent not found | Agent not in registry |
| `4408` | Connection/handshake timeout | Admin waited 30s for agent, or 5s ticket handshake expired |
| `4409` | Session conflict | Session already active for this agent |
| `4410` | Session terminated by admin | Admin terminated session via DELETE endpoint |
| `4500` | Policy not found | Agent's assigned policy missing |

## Related Documentation

- [WebSocket Relay](../01-concepts/websocket-relay.md) — connection pairing logic
- [tmux Sessions](../01-concepts/tmux-sessions.md) — what happens after pairing
- [Security Model](../01-concepts/security-model.md) — the 5-gate auth chain
- [API Overview](overview.md) — REST endpoint reference
