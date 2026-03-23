# CLI Usage

> The shell CLI (`shell`) provides command-line management of agents, policies, sessions, and interactive terminal connections.

## Configuration

The CLI reads its configuration from `~/.shell-cli/config.json`:

```json
{
  "serverUrl": "https://localhost:9494",
  "apiKeyPath": "~/.shell/api-key",
  "certPath": "~/.shell/cert.pem",
  "keyPath": "~/.shell/key.pem",
  "caPath": "~/.shell/ca.crt"
}
```

| Field | Required | Default | Purpose |
| --- | --- | --- | --- |
| `serverUrl` | Yes | — | Shell server endpoint |
| `apiKeyPath` | No | `~/.shell/api-key` | Bearer token file (standalone) |
| `certPath` | No | — | mTLS client certificate (plugin) |
| `keyPath` | No | — | mTLS private key (plugin) |
| `caPath` | No | — | CA certificate for server verification |

The installer creates this file automatically during standalone setup.

## Commands

### `shell connect <label>`

Open an interactive terminal session with an agent.

```bash
shell connect office-ubuntu
```

- Connects via WebSocket to `/api/shell/connect/<label>`
- Sets the terminal to raw mode (every keystroke sent immediately)
- Clears the screen and renders the full pane content on each update
- Handles terminal resize events automatically
- Press **Ctrl+]** to disconnect

This requires shell access to be enabled for the agent first.

### `shell enable <label>`

Enable shell access for an agent with a time window.

```bash
shell enable office-ubuntu
```

Prompts interactively for:
1. **Duration** — 5m, 10m, 15m, 30m, 1h, 2h, 4h, or 8h
2. **Policy** — which policy to apply (only if multiple policies exist)

Calls `POST /api/shell/enable/<label>` and displays the expiration time.

### `shell disable <label>`

Revoke shell access for an agent immediately.

```bash
shell disable office-ubuntu
```

Calls `DELETE /api/shell/enable/<label>`.

### `shell sessions`

List the session audit log.

```bash
shell sessions
```

Displays a table of recent sessions:
- Session ID
- Agent label
- Source IP
- Status (active/ended)
- Start time
- Duration

Sorted by start time, newest first.

### `shell recordings <label>`

List session recordings for an agent.

```bash
shell recordings office-ubuntu
```

Shows session ID, start/end times, and duration for each recording. Recordings are stored on the agent machine at `~/.shell-agent/recordings/` — the CLI indicates this if you attempt a download.

### `shell config`

Display the server configuration.

```bash
shell config
```

Shows:
- Enabled/disabled status
- Default policy name
- Number of configured policies

### `shell policies`

List all access policies.

```bash
shell policies
```

Shows each policy with:
- ID and name
- IP rules count
- Command blocklist entries
- Inactivity timeout
- Default policy indicator

### `shell uninstall`

Print uninstall instructions.

```bash
shell uninstall
```

Shows the commands to remove CLI configuration. Notes that this only removes CLI config — the server and agent have their own uninstall procedures.

### `shell --version`

Display the CLI version.

## Authentication

The CLI supports two authentication methods:

1. **API Key** (standalone) — reads the key from `apiKeyPath` and sends as `Authorization: Bearer <key>`
2. **mTLS** (plugin) — uses client certificate and key files for mutual TLS

All API calls use HTTPS with a 30-second timeout.

## Related Documentation

- [Desktop App](desktop-app.md) — graphical alternative
- [Standalone Setup](standalone-setup.md) — server installation
- [Agent Enrollment](agent-enrollment.md) — adding agents
