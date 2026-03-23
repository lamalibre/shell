# Standalone Setup

> Set up Shell as a self-contained server with its own CA, API key, and agent enrollment — an SSH alternative that does not depend on Portlama.

## Prerequisites

**Server machine (your Mac or a VPS):**
- Node.js 22+
- tmux installed (`brew install tmux` on macOS, `apt install tmux` on Linux)
- A port accessible to agent machines (default: 9494)

**Agent machine (remote macOS or Linux):**
- Node.js 22+
- tmux installed
- Network access to server port 9494

## Server Installation

### One-Command Setup

```bash
npx @lamalibre/create-shell
```

The installer runs interactively and performs:

1. **Platform detection** — verifies macOS or Linux, checks for tmux
2. **Directory creation** — creates `~/.shell/` with mode `0700`
3. **Package installation** — installs `@lamalibre/shell-server` and `@lamalibre/shell-agent` to `~/.shell/node_modules/`
4. **Server startup** — starts the server temporarily to generate CA and API key
5. **CA generation** — creates a 10-year root CA (`ca.crt` + `ca.key`) via node-forge
6. **API key generation** — creates a 32-byte hex key at `~/.shell/api-key`
7. **Join token creation** — generates a one-time token for agent enrollment
8. **CLI configuration** — creates `~/.shell-cli/config.json` pointing to localhost:9494
9. **Service installation** — creates a launchd plist (macOS) or systemd unit (Linux)
10. **Server shutdown** — stops the temporary server

At the end, the installer prints:
- The server URL
- A **join token** for enrolling agents (valid for 60 minutes)
- Instructions for enrolling remote agents

### What Gets Created

```
~/.shell/
├── package.json              # ESM project file
├── node_modules/             # shell-server + shell-agent
├── ca.crt                    # Root CA certificate (10-year)
├── ca.key                    # Root CA private key (0600)
├── server.crt                # Server TLS certificate (1-year)
├── server.key                # Server TLS private key (0600)
├── api-key                   # 32-byte hex admin API key (0600)
├── agents.json               # Agent registry
├── shell-config.json         # Global config + policies (0600)
├── shell-sessions.json       # Session audit log (0600)
└── join-tokens.json          # Active enrollment tokens

~/.shell-cli/
└── config.json               # CLI configuration
```

### Service Management

**macOS (launchd):**

```bash
# Check status
launchctl list | grep shell

# Stop
launchctl unload ~/Library/LaunchAgents/com.lamalibre.shell-server.plist

# Start
launchctl load ~/Library/LaunchAgents/com.lamalibre.shell-server.plist

# Logs
tail -f ~/.shell/shell-server.log
```

**Linux (systemd):**

```bash
# Check status
systemctl --user status shell-server

# Restart
systemctl --user restart shell-server

# Logs
journalctl --user -u shell-server -f
```

## Agent Enrollment

See [Agent Enrollment](agent-enrollment.md) for the complete guide.

Quick version:

```bash
# On the remote machine
npx @lamalibre/create-shell --join --server https://<server-ip>:9494 --token <join-token>
```

## Reconfiguring

If `~/.shell/` already exists, the installer prompts before overwriting. To start fresh:

```bash
# Stop the service first
launchctl unload ~/Library/LaunchAgents/com.lamalibre.shell-server.plist  # macOS
# or
systemctl --user stop shell-server  # Linux

# Remove state
rm -rf ~/.shell/ ~/.shell-cli/

# Reinstall
npx @lamalibre/create-shell
```

## Uninstalling

```bash
npx @lamalibre/create-shell --uninstall
```

This prints instructions to:
1. Stop and remove the launchd/systemd service
2. Remove `~/.shell/` and `~/.shell-cli/`

## Related Documentation

- [Agent Enrollment](agent-enrollment.md) — enrolling agents step by step
- [CLI Usage](cli-usage.md) — using the shell CLI
- [Desktop App](desktop-app.md) — graphical management interface
- [Deployment Modes](../01-concepts/deployment-modes.md) — standalone vs plugin comparison
