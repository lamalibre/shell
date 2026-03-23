# Deployment Modes

> Shell runs in three modes: standalone (your own server with its own CA), plugin (inside Portlama, using Portlama's existing certificates and relay), or tunnel (standalone server connected through Portlama's tunnel infrastructure).

## In Plain English

Think of Shell as a phone system. You need a switchboard to connect callers. The question is: do you run your own switchboard, or use an existing one?

**Standalone mode** is running your own switchboard. You set up a server, it generates its own security certificates, and it manages its own agent directory. The server is the relay, the authority, and the admin interface — all in one. This is ideal when you want a simple SSH alternative on your local network or when you do not use Portlama.

**Plugin mode** is plugging into Portlama's switchboard. Shell registers itself as a Fastify plugin inside Portlama's existing server. It uses Portlama's certificates, Portlama's agent registry, and Portlama's admin panel. No separate server, no separate CA, no separate port. This is ideal when you already use Portlama for tunneling and want to add terminal access.

## Comparison

|  | Standalone | Plugin | Tunnel |
| --- | --- | --- | --- |
| **Server** | Own Fastify server on port 9494 | Runs inside Portlama's Fastify instance | Own Fastify server + Portlama tunnel |
| **CA** | Own root CA (node-forge, 10-year) | Portlama's CA | Own root CA |
| **Agent certs** | Signed by own CA (`CN=agent:<label>`) | Portlama-issued certs | Ticket-based auth (P12 for panel API) |
| **Admin auth** | API key (Bearer token) | mTLS admin certificate | API key (Bearer token) |
| **Agent registry** | File-based (`~/.shell/agents.json`) | Portlama's agent registry (delegated) | File-based (`~/.shell/agents.json`) |
| **Install command** | `npx @lamalibre/create-shell` | Plugin registered in Portlama config | `npx @lamalibre/create-shell` (tunnel setup) |
| **Port** | 9494 (configurable) | Portlama's port (typically 9292 via nginx) | 9494 (via Portlama tunnel) |
| **Network requirement** | Agents need direct access to server | Agents connect through Portlama's relay | Agents connect via Portlama tunnel |
| **Management UI** | `shell-desktop` or `shell-cli` | Portlama panel + shell-desktop | `shell-desktop` or `shell-cli` |
| **State directory** | `~/.shell/` | Portlama's state directory | `~/.shell/` |

## Standalone Mode

### How It Works

```
Admin (this Mac)                       Agent (remote machine)
┌──────────────────┐                  ┌──────────────────────┐
│ shell-cli        │                  │ shell-agent serve    │
│ shell-desktop    │                  │                      │
└────────┬─────────┘                  └──────────┬───────────┘
         │                                       │
         │  HTTPS + mTLS                         │  HTTPS + mTLS
         │  Bearer API key                       │  Client cert
         │                                       │
         ▼                                       ▼
┌────────────────────────────────────────────────────────────┐
│  Shell Server (Fastify, port 9494)                          │
│                                                            │
│  Own CA  │  Own API key  │  Agent registry  │  WebSocket   │
│  (~/.shell/ca.crt)       │  (~/.shell/agents.json)         │
└────────────────────────────────────────────────────────────┘
```

The server generates a 10-year root CA on first start. Admin authenticates with a 32-byte hex API key stored in `~/.shell/api-key`. Agents authenticate with mTLS certificates signed by the server's CA.

### Authentication

**Admin operations** (REST API):
- Bearer token: `Authorization: Bearer <api-key>`
- The API key is generated during installation and stored at `~/.shell/api-key`

**Agent operations** (polling + WebSocket):
- mTLS client certificate with `CN=agent:<label>`
- Certificate signed by the server's CA during enrollment

### Enrollment Flow

1. Admin creates a one-time join token: `POST /api/shell/tokens`
2. Agent runs enrollment: `shell-agent enroll --server <url> --token <token>`
3. Agent generates RSA 2048 keypair + CSR with `CN=agent:<label>`
4. Server validates token, signs CSR, returns certificate + CA
5. Agent stores cert, key, and CA in `~/.shell-agent/`
6. Token is consumed (single-use)

## Plugin Mode

### How It Works

```
Admin (Portlama panel / desktop)       Agent (remote machine)
┌──────────────────┐                  ┌──────────────────────┐
│ Browser / App    │                  │ shell-agent serve    │
│ (admin cert)     │                  │ (agent cert)         │
└────────┬─────────┘                  └──────────┬───────────┘
         │                                       │
         │  mTLS (admin cert)                    │  mTLS (agent cert)
         │                                       │
         ▼                                       ▼
┌────────────────────────────────────────────────────────────┐
│  Portlama Server                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Shell Plugin (fastify-plugin)                        │  │
│  │  ├─ DelegatingAgentRegistry                           │  │
│  │  │   (reads/writes Portlama's agent registry)         │  │
│  │  ├─ All shell routes under /api/shell/*               │  │
│  │  └─ WebSocket relay                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  Portlama's mTLS middleware sets:                           │
│  ├─ request.certRole (admin / agent)                       │
│  └─ request.certLabel (agent label)                        │
└────────────────────────────────────────────────────────────┘
```

The shell plugin registers with Portlama via:

```javascript
import { shellPlugin } from '@lamalibre/shell-server';

fastify.register(shellPlugin, {
  stateDir: '/path/to/portlama/state',
  loadAgentRegistry: () => { /* read Portlama's agents */ },
  saveAgentRegistry: (data) => { /* write Portlama's agents */ },
});
```

### Authentication

Portlama's existing mTLS middleware handles authentication before shell routes execute. The plugin reads `request.certRole` and `request.certLabel` directly — no separate auth logic needed.

### Agent Registry

The `DelegatingAgentRegistry` bridges Portlama's agent schema to Shell's `ShellAgent` type. When Shell updates `shellEnabledUntil` or `shellPolicy` on an agent, the delegating registry writes those fields back to Portlama's agent record while preserving all other Portlama-specific fields.

## Tunnel Mode

### How It Works

Tunnel mode is a variant of standalone mode that connects through Portlama's tunnel infrastructure instead of requiring direct network access between admin and agent. The server runs its own Fastify instance (like standalone) but registers itself with the Portlama panel as a ticket instance, enabling agents to connect through Portlama's tunnel without needing mTLS certificates issued by the server's own CA.

```
Admin (this Mac)                       Agent (remote machine)
┌──────────────────┐                  ┌──────────────────────┐
│ shell-cli        │                  │ shell-agent serve    │
│ shell-desktop    │                  │ (mode: tunnel)       │
└────────┬─────────┘                  └──────────┬───────────┘
         │                                       │
         │  HTTPS + API key                      │  Polls panel ticket inbox
         │                                       │  Connects via agent-ticket WS
         │                                       │
         ▼                                       ▼
┌────────────────────────────────────────────────────────────┐
│  Shell Server (Fastify, standalone + tunnel.json)          │
│                                                            │
│  Own CA  │  Own API key  │  Ticket auth  │  WebSocket      │
│  Registered as ticket instance with Portlama panel         │
│  60s heartbeats to panel                                   │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           │  mTLS (P12)
                           ▼
                  ┌─────────────────────┐
                  │  Portlama Panel     │
                  │  Ticket system      │
                  │  Tunnel relay       │
                  └─────────────────────┘
```

### Activation

Tunnel mode activates automatically when a `tunnel.json` file exists in the server's state directory (typically `~/.shell/tunnel.json`). This file is created by `create-shell` during tunnel setup.

### Ticket-Based Agent Authentication

In tunnel mode, agents do not have mTLS certificates from the server's CA. Instead, they authenticate through a ticket flow:

1. Admin connects via `WS /api/shell/connect/:label` (standard mTLS/API key auth)
2. Server requests a ticket from the Portlama panel targeting the agent
3. Panel notifies the agent via its ticket inbox
4. Agent connects to `WS /api/shell/agent-ticket/:label` (no mTLS preHandler)
5. Agent sends `{ type: "ticket", ticketId: "<id>" }` as the first WebSocket message
6. Server validates the ticket (5s handshake timeout), checks global enabled flag, verifies the agent exists and is non-revoked, confirms `shellEnabledUntil` has not expired, and issues a session token
7. Agent uses the session token (`Bearer session:<token>`) for subsequent REST API calls

### Agent Configuration

Tunnel-mode agents use `TunnelAgentConfig` (mode: `'tunnel'`) which includes:
- `serverUrl` — the tunnel FQDN (e.g., `https://a3f7-shell.example.com`)
- `panelUrl` — the Portlama panel URL for ticket inbox polling
- `label` — the agent label
- `portlamaP12Path` and `portlamaP12Password` — P12 credentials for panel API calls

### Heartbeats

The server sends 60-second heartbeats to the Portlama panel to keep the ticket instance registration alive. If heartbeats stop, the panel marks the instance as offline.

## Choosing a Mode

**Choose standalone when:**
- You do not use Portlama
- You want a simple SSH alternative for your local network
- You need a self-contained setup with minimal dependencies
- You have direct network access between admin and agent machines

**Choose tunnel when:**
- You want your own standalone server but agents cannot reach it directly
- Your agents are behind firewalls or NAT
- You want Portlama's tunnel infrastructure without running Shell as a plugin
- You want API key admin auth (not mTLS) with tunnel-based agent connectivity

**Choose plugin when:**
- You already use Portlama for tunneling
- Your agents are behind firewalls without direct admin access
- You want a single management interface for tunnels and terminal access
- You want Portlama's existing certificate infrastructure

## Related Documentation

- [Standalone Setup](../02-guides/standalone-setup.md) — step-by-step server installation
- [Agent Enrollment](../02-guides/agent-enrollment.md) — enrolling agents in both modes
- [System Overview](../03-architecture/overview.md) — architecture details
- [Security Model](security-model.md) — authentication in detail
