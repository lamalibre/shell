# Agents & Sessions API

> Endpoints for managing agents, enabling/disabling shell access, and viewing the session audit log.

## Agents

### `GET /api/shell/agents`

List all registered agents. **Standalone mode only** — not available in plugin mode.

**Auth:** Admin only

**Response (200):**
```json
{
  "agents": [
    {
      "label": "office-ubuntu",
      "revoked": false,
      "shellEnabledUntil": "2026-03-24T11:00:00.000Z",
      "shellPolicy": "default"
    },
    {
      "label": "dev-mac",
      "revoked": false
    }
  ]
}
```

Agents with `shellEnabledUntil` set and in the future have active shell access.

### `GET /api/shell/agent-status`

Check shell access status. Agents can check their own status; admins can check any agent.

**Auth:** Admin or Agent

**Query params (admin only):** `?label=office-ubuntu`

**Response (200):**
```json
{
  "label": "office-ubuntu",
  "globalEnabled": true,
  "shellEnabled": true,
  "shellEnabledUntil": "2026-03-24T11:00:00.000Z",
  "policyId": "default",
  "commandBlocklist": {
    "hardBlocked": ["rm -rf /", "..."],
    "restricted": { "sudo": false, "su": false, "..." : false }
  }
}
```

When an agent calls this endpoint, it uses the label from its certificate. The response includes the command blocklist from the assigned policy, which the agent writes to `shell-blocklist.json`.

### `POST /api/shell/agents/:label/revoke`

Revoke an agent. Sets `revoked=true`, terminates any active session, and clears shell access.

**Auth:** Admin only

**Response (200):**
```json
{
  "ok": true,
  "label": "office-ubuntu"
}
```

**Errors:**
- `404` — agent not found
- `409` — agent already revoked

## Enable / Disable

### `POST /api/shell/enable/:label`

Enable shell access for an agent with a time window.

**Auth:** Admin only

**Request body:**
```json
{
  "durationMinutes": 30,
  "policyId": "production"
}
```

| Field | Required | Default | Range |
| --- | --- | --- | --- |
| `durationMinutes` | No | 30 | 5-480 |
| `policyId` | No | Server's default policy | Must exist |

**Response (200):**
```json
{
  "ok": true,
  "label": "office-ubuntu",
  "shellEnabledUntil": "2026-03-24T11:00:00.000Z",
  "shellPolicy": "production"
}
```

**Errors:**
- `400` — validation failed (duration out of range), global shell is disabled, or policy not found
- `404` — agent not found

### `DELETE /api/shell/enable/:label`

Disable shell access for an agent immediately.

**Auth:** Admin only

Clears `shellEnabledUntil` and `shellPolicy` from the agent record. If a session is active, the next 30-second time-window check will terminate it.

**Response (200):**
```json
{
  "ok": true,
  "label": "office-ubuntu"
}
```

**Errors:**
- `404` — agent not found

## Enrollment (Standalone)

### `POST /api/shell/tokens`

Create a one-time join token for agent enrollment.

**Auth:** Admin only

**Request body:**
```json
{
  "label": "office-ubuntu",
  "ttlMinutes": 10
}
```

| Field | Required | Default | Range |
| --- | --- | --- | --- |
| `label` | Yes | — | `[a-z0-9-]+`, 1-50 chars |
| `ttlMinutes` | No | 10 | 1-1440 |

**Response (200):**
```json
{
  "token": "a1b2c3d4e5f6...",
  "label": "office-ubuntu",
  "expiresAt": "2026-03-24T10:10:00.000Z"
}
```

### `POST /api/shell/enroll`

Agent enrollment with a one-time token and CSR.

**Auth:** Token-based (no mTLS required)

**Request body:**
```json
{
  "token": "a1b2c3d4e5f6...",
  "csr": "-----BEGIN CERTIFICATE REQUEST-----\n..."
}
```

**Response (200):**
```json
{
  "cert": "-----BEGIN CERTIFICATE-----\n...",
  "ca": "-----BEGIN CERTIFICATE-----\n...",
  "label": "office-ubuntu"
}
```

**Errors:**
- `401` — token invalid or expired
- `400` — invalid CSR

## Sessions

### `GET /api/shell/sessions`

List the session audit log (last 500 entries).

**Auth:** Admin only

**Response (200):**
```json
{
  "sessions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "agentLabel": "office-ubuntu",
      "sourceIp": "192.168.1.42",
      "status": "ended",
      "startedAt": "2026-03-24T10:30:00.000Z",
      "endedAt": "2026-03-24T10:45:00.000Z",
      "duration": 900
    }
  ]
}
```

### `DELETE /api/shell/sessions/:sessionId`

Terminate an active session. Closes both the admin and agent WebSocket connections.

**Auth:** Admin only

**Response (200):**
```json
{
  "ok": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Errors:**
- `404` — session not found

### `GET /api/shell/recordings/:label`

List session recordings for an agent.

**Auth:** Admin only

**Response (200):**
```json
{
  "recordings": [
    {
      "sessionId": "550e8400-e29b-41d4-a716-446655440000",
      "startedAt": "2026-03-24T10:30:00.000Z",
      "endedAt": "2026-03-24T10:45:00.000Z",
      "duration": 900,
      "status": "ended",
      "hasRecording": true
    }
  ]
}
```

### `GET /api/shell/recordings/:label/:sessionId`

Download a specific session recording.

**Auth:** Admin only

**Response (200):**

Returns the recording file content as `text/plain` with `Content-Disposition: attachment; filename="{label}-{sessionId}.log"`.

Recordings are captured via `tmux pipe-pane` and stored at `~/.shell-agent/recordings/<sessionId>.log` on the agent machine. The server retrieves the file from the agent on demand.

**Errors:**
- `404` — recording not found

## File Transfer

### `GET /api/shell/file/:label`

Download a file from an agent via WebSocket relay.

**Auth:** Admin only

**Query:** `?path=/var/log/syslog`

Requires an active session for the agent. The server relays the file download request to the agent over the existing WebSocket connection.

**Response (200):** Returns the file content as `application/octet-stream`.

**Errors:**
- `400` — invalid path (null bytes, `..` traversal, exceeds 4096 chars)
- `409` — no active session for this agent
- `502` — relay failure (agent unreachable or file transfer error)

### `POST /api/shell/file/:label`

Upload a file to an agent via WebSocket relay.

**Auth:** Admin only

**Query:** `?path=/home/user/deploy.sh`

Requires an active session for the agent. Accepts a raw body or JSON `{ "data": "<base64string>" }`.

**Response (200):**
```json
{
  "ok": true,
  "path": "/home/user/deploy.sh"
}
```

**Errors:**
- `400` — invalid path (null bytes, `..` traversal, exceeds 4096 chars) or missing request body
- `409` — no active session for this agent
- `502` — relay failure (agent unreachable or file transfer error)

Both endpoints run the 5-gate auth chain (`validateShellAccess`) in addition to checking for an active session, and validate the file path (no null bytes, no `..`, max 4096 chars).

## Related Documentation

- [Config & Policies API](config-policies.md) — policy management
- [WebSocket Protocol](websocket-protocol.md) — terminal relay messages
- [API Overview](overview.md) — authentication and error format
