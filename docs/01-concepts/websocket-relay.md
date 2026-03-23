# WebSocket Relay

> The shell server acts as a transparent WebSocket relay — it pairs an admin connection with an agent connection and forwards every frame between them without interpreting the terminal data.

## In Plain English

The relay works like a telephone operator connecting two callers. The admin calls in and says "I want to talk to office-mac." The operator checks credentials, then puts the admin on hold while waiting for the agent to call in. When the agent connects, the operator patches the lines together. From that point on, everything the admin says goes directly to the agent, and everything the agent says goes directly to the admin. The operator just relays — it does not listen to or modify the conversation.

Either side can connect first. If the admin connects before the agent, the admin waits (up to 30 seconds). If the agent connects first, the agent waits indefinitely until an admin arrives or the time window expires.

## For Users

### Connection Sequence

```
1. Admin connects WebSocket to /api/shell/connect/office-mac
   └── Server runs 5-gate auth chain
   └── Server checks: is agent already waiting?
       ├── Yes → pair immediately
       └── No → admin waits (up to 30 seconds)

2. Agent connects WebSocket to /api/shell/agent/office-mac
   └── Server validates: global enabled, cert label matches, time window valid
   └── Server checks: is admin already waiting?
       ├── Yes → pair immediately
       └── No → agent waits

3. Both connected → server pairs the WebSockets
   └── Admin receives: { type: "connected" }
   └── Agent receives: { type: "admin-connected" }
   └── Transparent relay begins

4. During session:
   └── Every frame from admin → forwarded to agent
   └── Every frame from agent → forwarded to admin
   └── Every 30 seconds → server checks time-window expiry

5. Session ends:
   └── One side disconnects → server closes the other side
   └── Time window expires → server closes both sides (code 4403)
   └── Server updates audit log
```

### Message Types

**Server → Admin:**

| Type | When | Payload |
| --- | --- | --- |
| `waiting` | Admin connected, agent not yet paired | `{ message }` |
| `connected` | Agent connected, relay active | `{ message }` |
| `error` | Auth or server error | `{ message }` |
| `time-window-expired` | `shellEnabledUntil` passed during session | — |

Agent disconnection is signaled via WebSocket close frame (code `1000`, reason `"Agent disconnected"`), not a JSON message.

**Server → Agent:**

| Type | When | Payload |
| --- | --- | --- |
| `waiting` | Agent connected, admin not yet paired | `{ message }` |
| `admin-connected` | Admin connected, relay active | `{ message }` |
| `error` | Auth or conflict error | `{ message }` |
| `time-window-expired` | Session window expired | — |

Admin disconnection is signaled via WebSocket close frame (code `1000`, reason `"Admin disconnected"`), not a JSON message.

**Agent → Server (relayed to Admin):**

| Type | When | Payload |
| --- | --- | --- |
| `agent-ready` | Agent connected, waiting for pairing | `{ label }` |
| `session-started` | tmux session spawned, I/O active | `{ sessionId }` |
| `output` | Terminal content changed | `{ data }` |

**Admin → Server (relayed to Agent):**

| Type | When | Payload |
| --- | --- | --- |
| `input` | User typed text | `{ data }` |
| `special-key` | Named key from allowlist | `{ key }` |
| `resize` | Terminal window resized | `{ cols, rows }` |

### Timeouts and Limits

| Parameter | Value |
| --- | --- |
| Admin waiting for agent | 30 seconds (then close `4408`) |
| Agent waiting for admin | No timeout (waits until admin or time-window expiry) |
| Time-window check interval | Every 30 seconds during active session |
| Sessions per agent | 1 (second connection gets `4409`) |
| Resize bounds | 1–500 cols, 1–500 rows |

### Close Codes

| Code | Meaning |
| --- | --- |
| `1000` | Normal closure (either side disconnected) |
| `1001` | Server shutting down |
| `1008` | Invalid agent label format |
| `1011` | Internal server error |
| `4400` | Global shell not enabled |
| `4401` | Invalid ticket (ticket handshake failed) |
| `4403` | Auth failed (cert, IP, time window, role) |
| `4404` | Agent not found in registry |
| `4408` | Connection/handshake timeout (30s admin wait or 5s ticket handshake) |
| `4409` | Session already active for this agent |
| `4410` | Session terminated by admin |
| `4500` | Policy not found |

## For Developers

### Connection Pairing

The server maintains three in-memory maps:

```
pendingAdminConnections: Map<label, { socket, request, sessionEntry, timeout, panelTicketId? }>
connectedAgents: Map<label, socket>
activeSessions: Map<label, { adminSocket, agentSocket, sessionEntry, timeWindowCheck, recording, terminated }>
```

Pairing logic:
1. Admin connects → check if agent is in `connectedAgents`
   - Yes: remove from `connectedAgents`, create active session, pair
   - No: add to `pendingAdminConnections` with 30s timeout
2. Agent connects → check if admin is in `pendingAdminConnections`
   - Yes: remove from `pendingAdminConnections`, create active session, pair
   - No: add to `connectedAgents`

When paired, the server sets up bidirectional forwarding:
```javascript
adminWs.on('message', (data) => agentWs.send(data));
agentWs.on('message', (data) => adminWs.send(data));
```

The relay is fully transparent — it does not parse or validate the JSON content of relayed messages.

### Time Window Enforcement During Sessions

A `setInterval` runs every 30 seconds after pairing:

```javascript
const timer = setInterval(async () => {
  const agent = await registry.findNonRevokedAgent(label);
  const enabled = agent?.shellEnabledUntil && new Date(agent.shellEnabledUntil) > new Date();
  if (!enabled) {
    adminWs.close(4403, 'Shell time window expired');
    agentWs.close(4403, 'Shell time window expired');
  }
}, 30_000);
```

### Session Cleanup

When either WebSocket closes:
1. Close the other WebSocket
2. Clear the time-window check timer
3. Remove from `activeSessions`
4. Update audit log with `endedAt` and `duration`

### Source Files

| File | Purpose |
| --- | --- |
| `packages/shell-server/src/relay.ts` | WebSocket routes, pairing logic, relay, timers |
| `packages/shell-agent/src/relay.ts` | Agent-side WebSocket, message dispatch, output polling |

### Related Documentation

- [tmux Sessions](tmux-sessions.md) — what happens on the agent side after pairing
- [Security Model](security-model.md) — the 5-gate auth chain that runs before pairing
- [WebSocket Protocol](../04-api-reference/websocket-protocol.md) — full message format reference
