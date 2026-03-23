# Config Files

> Quick reference for all files created and managed by Shell, their locations, permissions, and purposes.

## Server Files (`~/.shell/`)

| File | Mode | Purpose |
| --- | --- | --- |
| `shell-config.json` | `0600` | Global config: enabled flag, policies array, default policy ID |
| `shell-sessions.json` | `0600` | Session audit log (last 500 entries, auto-pruned) |
| `agents.json` | default | Agent registry: labels, revoked status, shell fields |
| `join-tokens.json` | default | Active enrollment tokens (auto-pruned on expiry) |
| `ca.crt` | `0644` | Root CA certificate (10-year validity) |
| `ca.key` | `0600` | Root CA private key (4096-bit RSA) |
| `server.crt` | `0644` | Server TLS certificate (1-year, signed by CA) |
| `server.key` | `0600` | Server TLS private key (2048-bit RSA) |
| `api-key` | `0600` | Admin API key (32-byte hex) |
| `tunnel.json` | `0600` | Tunnel mode config (present only in tunnel mode) |

Directory mode: `0700`

## Agent Files (`~/.shell-agent/`)

| File | Mode | Purpose |
| --- | --- | --- |
| `agent.json` | `0600` | Config: mode (`standalone`/`plugin`/`tunnel`), serverUrl, label; tunnel adds `panelUrl`, `portlamaP12Path`, `portlamaP12Password` |
| `cert.pem` | `0644` | Client certificate (standalone) |
| `key.pem` | `0600` | Private key (standalone) |
| `ca.crt` | `0644` | Server CA cert (standalone) |
| `shell-wrapper.sh` | `0755` | Command blocklist wrapper script |
| `shell-blocklist.json` | `0600` | Command blocklist (synced from policy) |
| `shell-history.log` | default | Command execution log (append-only) |
| `recordings/<uuid>.log` | default | Session recordings (one per session) |
| `.pem/client-cert.pem` | `0644` | Extracted from P12 (plugin mode) |
| `.pem/client-key.pem` | `0600` | Extracted from P12 (plugin mode) |

Directory mode: `0700`

## CLI Files (`~/.shell-cli/`)

| File | Purpose |
| --- | --- |
| `config.json` | CLI config: serverUrl, apiKeyPath, certPath, keyPath, caPath |

## Desktop App Files (`~/.shell-desktop/`)

| File | Purpose |
| --- | --- |
| `config.json` | App config: serverUrl, apiKey, caPath |

## System Service Files

### macOS (launchd)

| File | Purpose |
| --- | --- |
| `~/Library/LaunchAgents/com.lamalibre.shell-server.plist` | Server daemon |
| `~/Library/LaunchAgents/com.lamalibre.shell-agent.plist` | Agent daemon |

### Linux (systemd)

| File | Purpose |
| --- | --- |
| `~/.config/systemd/user/shell-server.service` | Server daemon |
| `~/.config/systemd/user/shell-agent.service` | Agent daemon |

## Write Patterns

All JSON state files use **atomic writes**: write to `<file>.tmp`, fsync, then rename into place. This ensures that a crash mid-write never corrupts the file.

Concurrent writes are serialized with **promise-chain mutexes** — one for shell config + sessions, one for the agent registry.

## Related Documentation

- [State Management](../03-architecture/state-management.md) — file formats and concurrency details
- [Security Model](../01-concepts/security-model.md) — file permission rationale
- [Shell Server](../03-architecture/shell-server.md) — server-side files
- [Shell Agent](../03-architecture/shell-agent.md) — agent-side files
