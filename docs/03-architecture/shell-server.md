# Shell Server

> The shell server is a Fastify 5 application that provides a REST API for management, a WebSocket relay for terminal sessions, and certificate authority services for agent enrollment.

## Dual-Mode Architecture

The server runs in two modes through a shared codebase:

**Standalone (`standalone.ts`):**
- Creates its own HTTPS server with mTLS support
- Generates a root CA via node-forge (4096-bit RSA, 10-year validity)
- Issues server TLS certificates (CN=localhost, SANs for 127.0.0.1 and ::1)
- Authenticates admins via Bearer API key (32-byte hex)
- Authenticates agents via mTLS client certificates
- Manages its own agent registry (`StandaloneAgentRegistry`, file-based)
- Default port: 9494, state directory: `~/.shell/`

**Plugin (`plugin.ts`):**
- Registers as a `fastify-plugin` inside Portlama
- Delegates authentication to Portlama's mTLS middleware (`request.certRole`, `request.certLabel`)
- Uses `DelegatingAgentRegistry` to read/write Portlama's agent records
- Registers agent routes (agent-status, agent WebSocket) in addition to admin routes
- Auto-registers `@fastify/websocket` if not already available
- Declares panel pages in `portlama-plugin.json`: agents, policies, sessions, recordings, settings
- No separate CA, API key, or HTTPS server

Both modes register the same routes and relay logic. The difference is authentication and agent registry storage.

## Route Map

### Public (no auth)

| Method | Path | Handler | Purpose |
| --- | --- | --- | --- |
| GET | `/api/shell/health` | `standalone.ts` | Health check (standalone only) |
| POST | `/api/shell/enroll` | `standalone.ts` | Agent enrollment with token + CSR |

### Admin Only

| Method | Path | Handler | Purpose |
| --- | --- | --- | --- |
| GET | `/api/shell/config` | `routes/config.ts` | Read global configuration |
| PATCH | `/api/shell/config` | `routes/config.ts` | Update enabled/defaultPolicy |
| GET | `/api/shell/policies` | `routes/policies.ts` | List all policies |
| POST | `/api/shell/policies` | `routes/policies.ts` | Create policy |
| PATCH | `/api/shell/policies/:policyId` | `routes/policies.ts` | Update policy |
| DELETE | `/api/shell/policies/:policyId` | `routes/policies.ts` | Delete policy |
| POST | `/api/shell/enable/:label` | `routes/enable.ts` | Enable shell for agent |
| DELETE | `/api/shell/enable/:label` | `routes/enable.ts` | Disable shell for agent |
| GET | `/api/shell/sessions` | `routes/sessions.ts` | List audit log |
| GET | `/api/shell/recordings/:label` | `routes/sessions.ts` | List recordings for agent |
| GET | `/api/shell/recordings/:label/:sessionId` | `routes/sessions.ts` | Download recording |
| GET | `/api/shell/agents` | `routes/agents.ts` | List all agents (standalone only) |
| GET | `/api/shell/file/:label` | `routes/files.ts` | Download file |
| POST | `/api/shell/file/:label` | `routes/files.ts` | Upload file |
| POST | `/api/shell/tokens` | `standalone.ts` | Create join token (standalone) |
| POST | `/api/shell/agents/:label/revoke` | `routes/agents.ts` | Revoke an agent |
| DELETE | `/api/shell/sessions/:sessionId` | `routes/sessions.ts` | Terminate active session |
| POST | `/api/shell/ticket` | `standalone.ts` | Issue single-use ticket (admin or agent) |

### Admin or Agent

| Method | Path | Handler | Purpose |
| --- | --- | --- | --- |
| GET | `/api/shell/agent-status` | `routes/agent-status.ts` | Check shell access status |

### WebSocket

| Method | Path | Handler | Purpose |
| --- | --- | --- | --- |
| GET | `/api/shell/connect/:label` | `relay.ts` | Admin initiates relay |
| GET | `/api/shell/agent/:label` | `relay.ts` | Agent provides relay (mTLS) |
| GET | `/api/shell/agent-ticket/:label` | `relay.ts` | Agent provides relay (ticket auth, tunnel mode) |

## Library Modules

### `lib/shell.ts` — Shell Management (core business logic)

- **Promise-chain mutex** — serializes all reads/writes to config and sessions files
- `readShellConfig()` — reads `shell-config.json`, applies defaults, handles legacy migration
- `writeShellConfig()` — atomic write with mutex
- `logShellSession()` — creates audit entry with UUID, returns session object
- `updateShellSession()` — updates session by ID (end time, duration)
- `readShellSessions()` — reads full audit log
- `enableAgentShell()` — sets `shellEnabledUntil` and `shellPolicy` on agent
- `disableAgentShell()` — clears both fields
- `validateShellAccess()` — runs 4 of 5 auth gates, returns `ShellAccessResult`

### `lib/registry.ts` — Agent Registry

- `StandaloneAgentRegistry` — file-based, `agents.json`, promise-chain mutex
- `DelegatingAgentRegistry` — wraps Portlama's load/save functions, converts between schemas
- Both implement: `findNonRevokedAgent()`, `updateAgent()`, `listAgents()`

### `lib/ip.ts` — IP Access Control

- Normalizes IPv4-mapped IPv6 addresses
- CIDR matching via bitwise operations
- Deny-takes-precedence evaluation

### `lib/file-utils.ts` — Atomic File I/O

- `atomicWriteJson()` — temp file → fsync → rename, mode `0o600`

### `lib/request-utils.ts` — HTTP Utilities

- `extractSourceIp()` — X-Real-IP → X-Forwarded-For → request.ip

## Certificate Management

### `cert/ca.ts`

- `ensureCa()` — generates 10-year root CA if missing (4096-bit RSA)
- `ensureServerCert()` — generates 1-year server cert (2048-bit RSA, signed by CA); accepts optional `extraSANs` for tunnel hostnames/IPs — regenerates if SANs change
- `signAgentCsr()` — signs agent CSR, returns 1-year cert with `CN=agent:<label>`

### `cert/token.ts`

- `createJoinToken()` — 32-byte random hex, default 10-min TTL, max 24 hours (1440 min)
- `consumeJoinToken()` — timing-safe validation, single-use consumption
- Tokens stored in `join-tokens.json`, expired tokens auto-pruned

## Validation Schemas

All input validated with Zod at the route level:

| Schema | Validates |
| --- | --- |
| `AgentLabelParamSchema` | `[a-z0-9-]+`, 1-50 chars |
| `PolicyIdSchema` | `[a-z0-9-]+`, 1-50 chars |
| `IpEntrySchema` | IPv4 or IPv4/CIDR |
| `CreatePolicySchema` | Full policy with defaults |
| `UpdatePolicySchema` | Partial policy (all optional) |
| `UpdateShellConfigSchema` | enabled + defaultPolicy |
| `EnableShellSchema` | Duration 5-480 min, optional policy |
| `FilePathQuerySchema` | No nulls, no `..`, max 4096 chars |
| `RecordingParamSchema` | Label + UUID sessionId |

## Source Files

| File | Lines | Purpose |
| --- | --- | --- |
| `src/standalone.ts` | ~370 | HTTPS server, CA, API key auth |
| `src/plugin.ts` | ~103 | Portlama integration wrapper (admin + agent routes, health endpoint, token endpoint) |
| `src/relay.ts` | ~1015 | WebSocket pairing, relay, file transfer, recordings |
| `src/routes/*.ts` | ~400 | REST endpoint handlers |
| `src/lib/shell.ts` | ~376 | Core business logic |
| `src/lib/registry.ts` | ~149 | Agent registry implementations |
| `src/lib/ip.ts` | ~85 | IP CIDR matching |
| `src/cert/ca.ts` | ~166 | PKI infrastructure |
| `src/cert/token.ts` | ~97 | Enrollment tokens |
| `src/lib/panel-api.ts` | — | Deprecated — panel API now handled by `@lamalibre/portlama-tickets` SDK |
| `src/lib/tunnel-auth.ts` | ~272 | Ticket store, session store, panel ticket map, tunnel config loader |
| `src/schemas.ts` | ~80 | Zod validation schemas |

## Related Documentation

- [Shell Agent](shell-agent.md) — the other side of the relay
- [State Management](state-management.md) — file formats and persistence
- [API Overview](../04-api-reference/overview.md) — REST API documentation
- [WebSocket Protocol](../04-api-reference/websocket-protocol.md) — message format reference
