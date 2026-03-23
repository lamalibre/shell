# Security Model

> Shell uses a defense-in-depth strategy with a 5-gate authentication chain, time-limited access windows, session recording, and an advisory command blocklist — so that no single control is the sole barrier between an attacker and a terminal session.

## In Plain English

Security in Shell works like a series of locked doors, each with a different key. To reach a terminal session, you must pass through all five doors. Failing at any door stops you completely.

The first door checks that you are an admin (not just any certificate holder). The second door checks whether shell access is even turned on globally. The third door checks that the remote machine's certificate is valid. The fourth door checks that the time window has not expired. The fifth door checks your IP address against an allowlist.

Even after you pass all five doors, the session is recorded to disk and logged in an audit trail. The command blocklist adds a speed bump for dangerous commands, but it is explicitly not a security boundary — determined users can bypass it. The real security is the auth chain, the time limits, and the recording.

## For Users

### What Protects You

Here is every security measure, from the outside in:

#### 1. Admin Role Verification

The first gate verifies that the connecting identity is an admin — not just any valid certificate holder. An agent certificate cannot open an admin WebSocket connection.

#### 2. Global Shell Toggle

Shell access can be disabled globally with a single switch. When disabled, all agent connections are rejected with code `4400` before any other check runs. This is the kill switch.

#### 3. Agent Certificate / Ticket Validation

Every agent connection is authenticated with a TLS client certificate or a single-use ticket. Without a valid, non-revoked certificate in the registry (or a valid ticket in tunnel mode), the connection is rejected. In standalone mode, admin auth uses an API key instead of a certificate.

| Certificate | CN Format | Issued By | Purpose |
| --- | --- | --- | --- |
| Admin (standalone/tunnel) | N/A (uses API key) | N/A | REST API management |
| Admin (plugin) | `admin` | Portlama CA | REST API + WebSocket |
| Agent (standalone) | `agent:<label>` | Server CA | Polling + WebSocket relay |
| Agent (plugin) | `agent:<label>` | Portlama CA | Polling + WebSocket relay |
| Agent (tunnel) | N/A (ticket-based) | `@lamalibre/portlama-tickets` SDK | Ticket handshake + session token for REST |

mTLS is stronger than passwords because:
- There is no password to brute-force
- There is no session to hijack
- The rejection happens before any HTTP traffic is exchanged

In tunnel mode, agents authenticate via single-use tickets issued through the Portlama panel. The ticket is consumed during a 5-second WebSocket handshake, after which the server issues a session token (1-hour TTL) for subsequent REST API calls. Ticket tokens are HMAC-hashed before storage to prevent timing-based leakage.

#### 4. Time-Limited Access Windows

Shell access is never permanently "on" for an agent. An admin enables access for a specific duration (5 minutes to 8 hours, default 30 minutes). The server stores a `shellEnabledUntil` timestamp on the agent record.

- Before connection: gate 4 rejects if the timestamp is in the past
- During active sessions: the relay re-checks every 30 seconds and disconnects both sides if expired
- On disable: the timestamp is cleared immediately

There is no way to set permanent access. Every session has a countdown.

#### 5. IP Access Control

Each policy defines allowed and denied IP ranges using IPv4 CIDR notation:

- **Deny takes precedence** — if an IP matches both allow and deny, it is denied
- **Empty allowlist = all IPs allowed** (unless denied)
- **Non-empty allowlist = only those IPs** can connect
- IPv6-mapped IPv4 addresses (like `::ffff:192.168.1.1`) are normalized automatically

Source IP is extracted from: `X-Real-IP` header → leftmost `X-Forwarded-For` → `request.ip`.

### The 5-Gate Chain

```
Admin connects to /api/shell/connect/:label
  │
  ├── Gate 1: Caller has admin role?
  │   └── No → close 4403 "Admin certificate required"
  │
  ├── Gate 2: Global shell enabled?
  │   └── No → close 4400 "Remote shell is not enabled globally"
  │
  ├── Gate 3: Agent certificate valid and not revoked?
  │   └── No → close 4404 "Agent not found"
  │
  ├── Gate 4: shellEnabledUntil in the future?
  │   └── No → close 4403 "Shell access not enabled for agent"
  │
  ├── Gate 5: Admin IP passes policy ACL?
  │   └── No → close 4403 "Source IP is not allowed"
  │
  └── All gates passed → create audit log entry → pair with agent
```

Gates are evaluated in order. The first failure terminates the connection. The admin role (gate 1) is also enforced at the route level via `requireRole(['admin'])` for defense in depth.

### Session Recording

Every terminal session is recorded to disk on the agent machine:

- **Recording path:** `~/.shell-agent/recordings/<session-uuid>.log`
- **Mechanism:** `tmux pipe-pane` captures raw I/O from the tmux session
- **Command history:** Logged separately in `~/.shell-agent/shell-history.log` with timestamps and EXEC/BLOCKED status
- **Audit log:** Server stores session metadata (ID, agent, IP, status, timestamps) in `shell-sessions.json`, last 500 entries

Recordings are stored on the agent machine, not the server. This ensures the recording captures everything tmux sees, even if the relay connection drops.

### Command Blocklist

The command blocklist is an **advisory guard rail**, not a security boundary. It prevents accidental execution of dangerous commands but can be bypassed by a determined user (via subshells, aliases, file editing, exec, etc.).

**Hard-blocked commands** (18 entries, prefix/exact match):

```
rm -rf /          rm -rf /*         rm -rf ~          rm -rf ~/*
mkfs              dd if=            :(){ :|:& };:
shutdown          reboot            halt              poweroff
chmod -R 777 /    > /dev/sda        > /dev/disk
curl|sh           curl|bash         wget|sh           wget|bash
```

**Restricted prefixes** (all blocked by default, individually enableable per policy via `true`):

```
sudo    su    launchctl    systemctl    networksetup
ifconfig    diskutil    iptables    ufw
```

Real security comes from the auth chain, time windows, and session recording — not from trying to filter terminal input.

### P12 Password Protection

When extracting certificates from P12 bundles (plugin and tunnel modes), Shell never passes the password as a command-line argument:

- **curl calls:** Password placed in a temporary config file created with `O_EXCL` + mode `0600`, deleted in a `try/finally` block
- **openssl calls:** Password passed via `SHELL_AGENT_P12_PASS` environment variable
- **Tunnel mode:** P12 extraction handled internally by the `@lamalibre/portlama-tickets` SDK via `createTicketDispatcher()`

This prevents the password from appearing in process listings (`ps aux`).

## For Developers

### Gate Implementation

The 5-gate chain is implemented in `packages/shell-server/src/relay.ts` (`runAdminAuthGates()`):

```
runAdminAuthGates(request, label)
  → gate 1: checks admin role (auth.role === 'admin')
  → gate 2: reads shell config (enabled check)
  → gate 3: finds agent in registry (exists + not revoked)
  → gate 4: checks shellEnabledUntil (time window)
  → resolves policy from agent.shellPolicy or default
  → gate 5: checks source IP against policy ACLs
  → returns { ok, agent, config, policy }
```

Gate 1 (admin role) is also enforced at the route level via `requireRole(['admin'])` for defense in depth.

### IP Matching

IP access control is implemented in `packages/shell-server/src/lib/ip.ts`:

1. Normalize IPv4-mapped IPv6: strip `::ffff:` prefix
2. Parse CIDR: split on `/`, validate prefix length (1-32)
3. Match: convert IP and CIDR base to 32-bit integers, compare with bitmask
4. Evaluate: check deny list first (if match → denied), then check allow list (if empty → allowed; if match → allowed; else → denied)

### Time Window Enforcement

Two enforcement points:

1. **At connection time:** `validateShellAccess()` checks `shellEnabledUntil > now`
2. **During active sessions:** `setInterval` in `relay.ts` checks every 30 seconds; if expired, sends close code `4403` with "Shell time window expired" to both sockets

### Atomic File Writes

All sensitive state files use the temp-fsync-rename pattern:

```javascript
async function atomicWriteJson(filePath, data) {
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();
  await rename(tmpPath, filePath);
}
```

This prevents partial reads — the file appears at its final path in a single atomic operation.

### File Permissions

| File | Mode | Rationale |
| --- | --- | --- |
| `~/.shell/` | `0700` | Server state directory |
| `~/.shell/ca.key` | `0600` | CA private key |
| `~/.shell/api-key` | `0600` | Admin authentication |
| `~/.shell/shell-config.json` | `0600` | Policies and enabled state |
| `~/.shell/shell-sessions.json` | `0600` | Session audit log |
| `~/.shell-agent/` | `0700` | Agent state directory |
| `~/.shell-agent/key.pem` | `0600` | Agent private key |
| `~/.shell-agent/shell-blocklist.json` | `0600` | Command blocklist |
| `~/.shell-agent/.pem/` | `0700` | Temporary P12 extraction |

### Input Validation

All REST inputs are validated with Zod schemas at the route level:

| Schema | Validates |
| --- | --- |
| `AgentLabelParamSchema` | `[a-z0-9-]+`, 1-50 chars |
| `PolicyIdSchema` | `[a-z0-9-]+`, 1-50 chars |
| `IpEntrySchema` | IPv4 or IPv4/CIDR, prefix 1-32 |
| `EnableShellSchema` | Duration 5-480 min, optional policy ID |
| `FilePathQuerySchema` | No null bytes, no `..`, max 4096 chars |
| `CreatePolicySchema` | Name 1-100 chars, description max 500 |

WebSocket special keys are validated against a fixed allowlist — any key not in the list is rejected.

## Quick Reference

### Security Layers

| Layer | Technology | Blocks |
| --- | --- | --- |
| Global toggle | Config flag | All access when disabled |
| Certificate auth | mTLS / API key | Unauthorized connections |
| Time windows | `shellEnabledUntil` | Expired or non-enabled access |
| IP access control | CIDR matching | Connections from disallowed IPs |
| Role verification | Certificate CN parsing | Non-admin WebSocket connections |
| Command blocklist | Shell wrapper (advisory) | Accidental dangerous commands |
| Session recording | tmux pipe-pane | Unaudited sessions |
| File permissions | chmod 600/700 | Unauthorized file access |
| Atomic writes | temp → fsync → rename | Corrupted state files |

### WebSocket Close Codes

| Code | Meaning |
| --- | --- |
| `1000` | Normal closure |
| `1001` | Server shutting down |
| `1008` | Invalid agent label |
| `1011` | Internal server error |
| `4400` | Global shell not enabled |
| `4401` | Invalid ticket (ticket handshake failed) |
| `4403` | Auth failed (cert, IP, time window, role) |
| `4404` | Agent not found |
| `4408` | Connection/handshake timeout (30s admin wait or 5s ticket handshake) |
| `4409` | Session already active for this agent |
| `4410` | Session terminated by admin |
| `4500` | Agent's assigned policy not found |

### Related Documentation

- [Deployment Modes](deployment-modes.md) — standalone vs plugin authentication
- [WebSocket Relay](websocket-relay.md) — connection lifecycle and close codes
- [Config Files](../05-reference/config-files.md) — file locations and formats
- [API Overview](../04-api-reference/overview.md) — authentication headers and error codes
