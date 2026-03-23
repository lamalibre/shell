# State Management

> All Shell state is stored in JSON files with atomic writes and promise-chain mutexes for concurrency control. No database is required.

## Design Philosophy

Shell stores state in flat JSON files rather than a database. At this scale — a handful of agents, one admin, a few policies — a database adds a process dependency, migration complexity, and operational overhead for no benefit.

Every write follows the **atomic rename pattern**: write to a temp file, fsync, rename into place. This ensures that a crash mid-write never corrupts the file — the old content remains intact until the rename succeeds.

Concurrent writes are serialized with a **promise-chain mutex** — a lightweight lock that queues write operations without blocking the event loop.

## Server-Side Files (`~/.shell/`)

### `shell-config.json`

Global configuration: enabled flag, policies, and default policy.

```json
{
  "enabled": true,
  "defaultPolicy": "default",
  "policies": [
    {
      "id": "default",
      "name": "Default",
      "description": "Standard shell access with restricted commands",
      "allowedIps": [],
      "deniedIps": [],
      "maxFileSize": 104857600,
      "inactivityTimeout": 600,
      "commandBlocklist": {
        "hardBlocked": ["rm -rf /", "rm -rf /*", "mkfs", "..."],
        "restricted": {
          "sudo": false,
          "su": false,
          "launchctl": false,
          "systemctl": false,
          "networksetup": false,
          "ifconfig": false,
          "diskutil": false,
          "iptables": false,
          "ufw": false
        }
      }
    }
  ]
}
```

- **Mode:** `0600`
- **Mutex:** `withShellLock` serializes all reads that lead to writes
- **Migration:** handles legacy flat format (policies at top level)
- **Defaults:** missing fields filled from `DEFAULT_POLICY`

### `shell-sessions.json`

Session audit log — last 500 entries, oldest pruned on write.

```json
[
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
```

- **Mode:** `0600`
- **Mutex:** `withShellLock`
- **Status values:** `pending` (initial) → `ended` (set on session close, with `endedAt` and `duration`) or `terminated` (set when admin terminates via `DELETE /sessions/:sessionId`). The `active` status exists in memory during the session but is not persisted to disk.
- **Pruning:** entries beyond 500 are removed (oldest first) on every write

### `agents.json`

Agent registry (standalone mode only).

```json
{
  "agents": [
    {
      "label": "office-ubuntu",
      "revoked": false,
      "shellEnabledUntil": "2026-03-24T11:00:00.000Z",
      "shellPolicy": "default"
    }
  ]
}
```

- **Mode:** default
- **Mutex:** separate promise-chain lock in `StandaloneAgentRegistry`
- **Shell fields:** `shellEnabledUntil` and `shellPolicy` are set by `enableAgentShell()` and cleared by `disableAgentShell()`

### `join-tokens.json`

Active enrollment tokens (standalone mode only).

```json
[
  {
    "token": "a1b2c3d4e5f6...",
    "label": "office-ubuntu",
    "createdAt": "2026-03-24T10:00:00.000Z",
    "expiresAt": "2026-03-24T10:10:00.000Z"
  }
]
```

- Tokens consumed via timing-safe comparison
- Expired tokens auto-pruned on each read
- Default TTL: 10 minutes, max: 24 hours (1440 minutes)

### `tunnel.json`

Tunnel mode configuration (present only when server runs in tunnel mode).

```json
{
  "fqdn": "a3f7-shell.example.com",
  "subdomain": "a3f7-shell",
  "tunnelId": "550e8400-e29b-41d4-a716-446655440000",
  "panelUrl": "https://panel.example.com:9292",
  "portlamaP12Path": "/Users/you/.portlama/client.p12",
  "portlamaP12Password": "generated-password",
  "createdAt": "2026-03-24T10:00:00.000Z"
}
```

- **Mode:** `0600`
- Created by `create-shell` during tunnel setup
- If present, the server activates tunnel mode on startup: registers a ticket instance with the Portlama panel and starts 60s heartbeats
- Fields: `fqdn` (tunnel hostname), `subdomain`, `tunnelId`, `panelUrl` (Portlama panel URL), `portlamaP12Path` (path to P12 bundle for panel API calls), `portlamaP12Password`, `createdAt`

### `ca.crt` + `ca.key`

Root CA certificate and private key (standalone mode).

- **CA key:** 4096-bit RSA, mode `0600`
- **CA cert:** 10-year validity
- Generated on first server start via node-forge

### `server.crt` + `server.key`

Server TLS certificate (standalone mode).

- **Server key:** 2048-bit RSA, mode `0600`
- **Server cert:** 1-year validity, signed by CA
- CN=localhost, SANs: localhost, 127.0.0.1, ::1 (plus tunnel FQDN when in tunnel mode)

### `api-key`

Admin authentication key (standalone mode).

- 32-byte random hex string
- Mode `0600`
- Used as Bearer token for REST API

## Agent-Side Files (`~/.shell-agent/`)

### `agent.json`

Agent configuration.

**Standalone:**
```json
{
  "mode": "standalone",
  "serverUrl": "https://192.168.1.100:9494",
  "label": "office-ubuntu",
  "certPath": "/Users/you/.shell-agent/cert.pem",
  "keyPath": "/Users/you/.shell-agent/key.pem",
  "caPath": "/Users/you/.shell-agent/ca.crt"
}
```

**Tunnel:**
```json
{
  "mode": "tunnel",
  "serverUrl": "https://a3f7-shell.example.com",
  "panelUrl": "https://panel.example.com:9292",
  "label": "office-ubuntu",
  "portlamaP12Path": "/Users/you/.portlama/client.p12",
  "portlamaP12Password": "generated-password"
}
```

- Mode `0600`
- Atomic writes
- Three config shapes: `StandaloneAgentConfig`, `PluginAgentConfig`, `TunnelAgentConfig` — discriminated by `mode` field

### `shell-blocklist.json`

Command blocklist synced from the assigned policy when the agent connects.

```json
{
  "hardBlocked": ["rm -rf /", "rm -rf /*", "mkfs", "..."],
  "blockedPatterns": [],
  "restrictedPrefixes": ["sudo", "su", "launchctl", "systemctl", "..."]
}
```

- Mode `0600`
- Written by agent on WebSocket connect (transformed from server's `CommandBlocklist` format)
- The agent converts `restricted: { "sudo": false }` (boolean map) into `restrictedPrefixes: ["sudo"]` (string array) — entries with value `false` (not allowed) become restricted prefixes
- `blockedPatterns` is always empty (reserved for future regex patterns)
- Read by `shell-wrapper.sh` on each command

### `shell-history.log`

Append-only command execution log.

```
2026-03-24T10:30:15Z EXEC: ls -la
2026-03-24T10:30:20Z EXEC: cd /var/log
2026-03-24T10:30:25Z BLOCKED: rm -rf /
2026-03-24T10:30:30Z EXEC: tail -f syslog
```

### `recordings/<uuid>.log`

Raw terminal I/O captured by `tmux pipe-pane`. One file per session, named by the session UUID.

### Certificate Files

| File | Mode | Purpose |
| --- | --- | --- |
| `cert.pem` | `0644` | Client certificate (standalone) |
| `key.pem` | `0600` | Private key (standalone) |
| `ca.crt` | `0644` | Server CA (standalone, for future verification) |
| `.pem/client-cert.pem` | `0644` | Extracted from P12 (plugin) |
| `.pem/client-key.pem` | `0600` | Extracted from P12 (plugin) |

## Concurrency Model

### Promise-Chain Mutex

Shell uses a lightweight mutex that serializes async operations without blocking the event loop:

```javascript
function createLock() {
  let chain = Promise.resolve();
  return (fn) => {
    const prev = chain;
    let resolve;
    chain = new Promise(r => { resolve = r; });
    return prev.then(fn).finally(() => resolve());
  };
}
```

Each lock queues operations in order. Two locks exist:
1. `withShellLock` — serializes config + sessions writes in `lib/shell.ts`
2. Registry lock — serializes agent registry writes in `lib/registry.ts`

### Atomic Write Pattern

```javascript
async function atomicWriteJson(filePath, data) {
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  // fsync ensures data reaches disk before rename
  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();
  await rename(tmpPath, filePath);
}
```

The `rename` is atomic on the same filesystem — the file appears at its final path in a single operation. This prevents any reader from seeing a partially written file.

## In-Memory State (Relay)

The WebSocket relay maintains ephemeral state during active sessions:

```
pendingAdminConnections: Map<label, { socket, timeout, sessionEntry }>
connectedAgents: Map<label, socket>
activeSessions: Map<label, { adminSocket, agentSocket, sessionEntry, timeWindowCheck, recording, terminated }>
```

This state is not persisted — it exists only while the server process is running. On restart, all active sessions are terminated. The audit log records the session start, so sessions that end due to server restart show no `endedAt` (they can be identified as abnormal terminations).

## Related Documentation

- [Shell Server](shell-server.md) — server architecture
- [Shell Agent](shell-agent.md) — agent file layout
- [Config Files](../05-reference/config-files.md) — quick reference table
- [Security Model](../01-concepts/security-model.md) — file permissions
