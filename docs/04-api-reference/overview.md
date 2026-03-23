# API Overview

> The Shell server exposes a JSON REST API for management operations and WebSocket endpoints for terminal relay, protected by API key or mTLS client certificates depending on deployment mode.

## In Plain English

When you use the CLI or desktop app to manage Shell — enabling access for an agent, viewing sessions, creating policies — every action maps to a REST API call. The CLI sends JSON requests to the server, the server makes changes to its state files, and sends back a JSON response.

The terminal relay uses WebSocket connections instead of REST. When you connect to an agent, your client opens a WebSocket and the agent opens another. The server pairs them and forwards every frame between them transparently.

## Base URL

**Standalone mode:**
```
https://localhost:9494/api/shell/...
```

**Plugin mode (inside Portlama):**
```
https://panel.<domain>/api/shell/...
```

## Authentication

### Standalone Mode

Two authentication mechanisms:

**API Key (admin operations):**
```
Authorization: Bearer <32-byte-hex-api-key>
```

The API key is generated during installation and stored at `~/.shell/api-key`.

**mTLS Client Certificate (agent operations):**
- Agent certificates have `CN=agent:<label>`
- Presented during TLS handshake
- Server extracts role and label from the certificate's Common Name

**Development mode** (`NODE_ENV=development`): mTLS checking is bypassed. A warning is logged on startup.

**Session Token (tunnel-mode agents):**
```
Authorization: Bearer session:<64-char-hex-token>
```

Session tokens are issued during the ticket handshake on the `agent-ticket` WebSocket endpoint. When an agent connects via ticket-based auth in tunnel mode, the server validates the ticket and returns a session token. The agent then uses this token as a Bearer credential (with the `session:` prefix) for subsequent REST API calls such as `GET /api/shell/agent-status`. Session tokens expire after 1 hour.

### Plugin Mode

Portlama's mTLS middleware handles authentication before Shell routes execute:
- Admin: certificate with `CN=admin` → `request.certRole = 'admin'`
- Agent: certificate with `CN=agent:<label>` → `request.certRole = 'agent'`, `request.certLabel = '<label>'`

No API keys — everything is certificate-based.

## Content Type

All request and response bodies use `application/json`. Requests with a JSON body must include `Content-Type: application/json`.

## Error Format

Every error response follows a consistent structure:

```json
{
  "error": "Human-readable error summary"
}
```

### Validation Errors (400)

Input validated with Zod schemas at the route level:

```json
{
  "error": "Validation failed",
  "issues": [
    {
      "path": ["label"],
      "message": "Agent label must be lowercase alphanumeric with hyphens, 1-50 chars"
    }
  ]
}
```

### Common Status Codes

| Code | Meaning | Example |
| --- | --- | --- |
| 200 | Success | Config retrieved, policy created |
| 400 | Validation failed | Invalid label format, bad CIDR |
| 403 | Auth failed | Missing API key, wrong role |
| 404 | Not found | Agent or policy does not exist |
| 409 | Conflict | Policy ID already exists |
| 502 | Relay error | File transfer relay failures |

## Endpoint Summary

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/shell/health` | None | Health check (standalone) |
| POST | `/api/shell/enroll` | Token | Agent enrollment |
| POST | `/api/shell/tokens` | Admin | Create join token (standalone) |
| GET | `/api/shell/config` | Admin | Read global config |
| PATCH | `/api/shell/config` | Admin | Update enabled/defaultPolicy |
| GET | `/api/shell/policies` | Admin | List policies |
| POST | `/api/shell/policies` | Admin | Create policy |
| PATCH | `/api/shell/policies/:policyId` | Admin | Update policy |
| DELETE | `/api/shell/policies/:policyId` | Admin | Delete policy |
| POST | `/api/shell/enable/:label` | Admin | Enable shell for agent |
| DELETE | `/api/shell/enable/:label` | Admin | Disable shell for agent |
| GET | `/api/shell/agent-status` | Admin/Agent | Check access status |
| GET | `/api/shell/sessions` | Admin | List audit log |
| DELETE | `/api/shell/sessions/:sessionId` | Admin | Terminate active session |
| GET | `/api/shell/agents` | Admin | List all agents |
| POST | `/api/shell/agents/:label/revoke` | Admin | Revoke agent |
| GET | `/api/shell/recordings/:label` | Admin | List recordings |
| GET | `/api/shell/recordings/:label/:sessionId` | Admin | Download recording |
| GET | `/api/shell/file/:label` | Admin | Download file |
| POST | `/api/shell/file/:label` | Admin | Upload file |
| POST | `/api/shell/ticket` | Admin/Agent | Issue a single-use ticket |
| WS | `/api/shell/connect/:label` | Admin | Admin WebSocket relay |
| WS | `/api/shell/agent/:label` | Agent | Agent WebSocket relay (mTLS) |
| WS | `/api/shell/agent-ticket/:label` | Public+Ticket | Agent WebSocket relay (ticket auth) |

## Validation Schemas

| Input | Rules |
| --- | --- |
| Agent label | `[a-z0-9-]+`, 1-50 chars |
| Policy ID | `[a-z0-9-]+`, 1-50 chars |
| IP entry | IPv4 or IPv4/CIDR, prefix 1-32 |
| Duration | 5-480 minutes (default 30) |
| Policy name | 1-100 chars |
| Description | Max 500 chars |
| File path | No null bytes, no `..`, max 4096 chars |
| Session ID | UUID format |
| Resize cols/rows | 1-500 |

## Quick Reference

| Item | Value |
| --- | --- |
| **Base URL (standalone)** | `https://localhost:9494/api/shell` |
| **Authentication** | API key (admin) or mTLS (agent/plugin) |
| **Content-Type** | `application/json` |
| **Validation** | Zod schemas at route level |
| **Error format** | `{ "error": "..." }` |
| **WebSocket protocol** | `wss://` with JSON messages |
| **Max sessions per agent** | 1 |
| **Admin WebSocket timeout** | 30 seconds waiting for agent |

## Related Documentation

- [Config & Policies API](config-policies.md) — config and policy endpoints in detail
- [Agents & Sessions API](agents-sessions.md) — agent management and audit log
- [WebSocket Protocol](websocket-protocol.md) — message format reference
- [Security Model](../01-concepts/security-model.md) — authentication gates
