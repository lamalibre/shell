# Desktop & CLI Coverage Report

> Updated 2026-03-28. Compares shell-desktop and shell-cli feature coverage against shell-server and shell-agent capabilities.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully implemented |
| ⚠️ | Partially implemented |
| N/A | Not applicable to this client |

---

## 1. Server API Endpoint Coverage

### Configuration

| Endpoint | Method | Desktop | CLI | Notes |
|----------|--------|---------|-----|-------|
| `/api/shell/health` | GET | ✅ | ✅ | |
| `/api/shell/config` | GET | ✅ | ✅ | |
| `/api/shell/config` | PATCH | ✅ | ✅ | CLI: `shell config --enable/--disable` |

### Agent Management

| Endpoint | Method | Desktop | CLI | Notes |
|----------|--------|---------|-----|-------|
| `/api/shell/agents` | GET | ✅ | ✅ | CLI: `shell agents` |
| `/api/shell/agents/:label/revoke` | POST | ✅ | N/A | Desktop: revoke button with confirmation |
| `/api/shell/enable/:label` | POST | ✅ | ✅ | |
| `/api/shell/enable/:label` | DELETE | ✅ | ✅ | |
| `/api/shell/agent-status` | GET | N/A | N/A | Used by agent daemon only |

### Policy Management

| Endpoint | Method | Desktop | CLI | Notes |
|----------|--------|---------|-----|-------|
| `/api/shell/policies` | GET | ✅ | ✅ | |
| `/api/shell/policies` | POST | ✅ | ✅ | CLI: `shell policy create` |
| `/api/shell/policies/:id` | PATCH | ✅ | ✅ | CLI: `shell policy update <id>` |
| `/api/shell/policies/:id` | DELETE | ✅ | ✅ | CLI: `shell policy delete <id>` |

### Sessions & Recordings

| Endpoint | Method | Desktop | CLI | Notes |
|----------|--------|---------|-----|-------|
| `/api/shell/sessions` | GET | ✅ | ✅ | |
| `/api/shell/sessions/:id` | DELETE | ✅ | N/A | Desktop: terminate button on active sessions |
| `/api/shell/recordings/:label` | GET | ✅ | ✅ | Desktop: Recordings tab; CLI: `shell recordings <label>` |
| `/api/shell/recordings/:label/:id` | GET | ✅ | ✅ | Server-side recording capture; CLI: `--download <id>` |

### Shell Relay (WebSocket)

| Endpoint | Desktop | CLI | Notes |
|----------|---------|-----|-------|
| `/api/shell/connect/:label` | ⚠️ | ✅ | Desktop delegates to `shell-cli connect` via Tauri shell plugin |

### Enrollment & Tokens (Standalone Only)

| Endpoint | Method | Desktop | CLI | Notes |
|----------|--------|---------|-----|-------|
| `/api/shell/tokens` | POST | ✅ | ✅ | Desktop: "Create Join Token" button; CLI: `shell tokens create` |
| `/api/shell/enroll` | POST | N/A | N/A | Used by shell-agent only |

### File Transfer

| Endpoint | Method | Desktop | CLI | Notes |
|----------|--------|---------|-----|-------|
| `/api/shell/file/:label` | GET | ✅ | N/A | No CLI command; server proxies via WebSocket relay to agent |
| `/api/shell/file/:label` | POST | ✅ | N/A | No CLI command; server proxies via WebSocket relay to agent |

### Ticket System (Tunnel Mode)

| Endpoint | Method | Desktop | CLI | Notes |
|----------|--------|---------|-----|-------|
| `/api/shell/ticket` | POST | N/A | N/A | Used by agent daemon internally |
| `/api/shell/agent-ticket/:label` | GET (WS) | N/A | N/A | Agent-only endpoint |

---

## 2. Feature Coverage Matrix

### Core Workflows

| Feature | Desktop | CLI | Notes |
|---------|---------|-----|-------|
| Interactive shell session | ⚠️ | ✅ | Desktop shells out to `shell-cli connect` |
| View agent list | ✅ | ✅ | |
| Enable shell access (duration + policy) | ✅ | ✅ | |
| Disable shell access | ✅ | ✅ | |
| View session history | ✅ | ✅ | |
| Terminate active session | ✅ | N/A | Desktop only |
| View session recordings | ✅ | ✅ | |
| Download session recording | ✅ | ✅ | |
| View server config | ✅ | ✅ | |
| Toggle global shell enable | ✅ | ✅ | |
| List policies | ✅ | ✅ | |
| Create policy | ✅ | ✅ | |
| Edit policy | ✅ | ✅ | |
| Delete policy | ✅ | ✅ | |
| Health monitoring | ✅ | ✅ | |
| Create join token | ✅ | ✅ | |
| Revoke agent | ✅ | N/A | Desktop only |
| Uninstall / cleanup | N/A | ✅ | CLI only |

### Policy Field Editing

| Policy Field | Desktop UI | CLI | Notes |
|--------------|-----------|-----|-------|
| Name | ✅ | ✅ | |
| Description | ✅ | ✅ | |
| Allowed IPs | ✅ | ✅ | Comma/newline separated |
| Denied IPs | ✅ | ✅ | Comma/newline separated |
| Inactivity timeout | ✅ | ✅ | 60-7200 seconds |
| Max file size | ✅ | ✅ | Desktop: MB input; CLI: bytes |
| Command blocklist (hard blocked) | ✅ | N/A | Desktop: textarea, one per line |
| Command blocklist (restricted) | ✅ | N/A | Desktop: textarea, one per line |

### Authentication Support

| Auth Method | Desktop | CLI | Notes |
|-------------|---------|-----|-------|
| API key (Bearer token) | ✅ | ✅ | |
| mTLS client certificates | ✅ | ✅ | Desktop: configured via Settings |
| Custom CA certificate | ✅ | ✅ | |

### UX Features

| Feature | Desktop | CLI | Notes |
|---------|---------|-----|-------|
| Auto-refresh / polling | ✅ | N/A | Agents 15s, Sessions 10s, Recordings 15s, Health 30s |
| System tray | ✅ | N/A | |
| Search & filter | ✅ | N/A | Agents, sessions, policies pages |
| Bulk operations | ✅ | N/A | Bulk enable/disable on agents page |
| Settings management | ✅ | N/A | Server URL, API key, cert paths |
| Terminal raw mode | N/A | ✅ | |
| Terminal resize handling | N/A | ✅ | |
| Interactive prompts | N/A | ✅ | @clack/prompts for policy/enable/tokens |
| Colored output | N/A | ✅ | picocolors |
| Status indicators | ✅ | ✅ | Color badges / colored text |

---

## 3. Coverage Summary

| | Desktop | CLI |
|-|---------|-----|
| **Server REST endpoints** | 18 / 18 (100%) | 14 / 18 (78%) |
| **WebSocket endpoints** | 1 / 1 (via CLI) | 1 / 1 (100%) |
| **Core workflows** | 17 / 18 (94%) | 16 / 18 (89%) |
| **Policy fields** | 8 / 8 (100%) | 6 / 8 (75%) |
| **Auth methods** | 3 / 3 (100%) | 3 / 3 (100%) |

### Combined Coverage

When using both desktop and CLI together, **all server REST endpoints are covered (100%)**. Agent-internal endpoints (`/agent-status`, `/ticket`, `/agent-ticket/:label`, `/enroll`) are correctly scoped to the agent daemon only.

### Remaining Architectural Note

The desktop app delegates interactive shell sessions to `shell-cli connect` via the Tauri shell plugin rather than embedding a terminal (xterm.js). This is a design choice, not a gap — it reuses the CLI's mature WebSocket + raw terminal implementation.
