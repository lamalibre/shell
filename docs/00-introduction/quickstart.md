# Quick Start

> From zero to first terminal session in 10 minutes.

## Standalone Mode (SSH Alternative)

This guide sets up Shell on your local network — your Mac as the server, a remote machine as the agent.

### Prerequisites

- **Server machine** (your Mac): Node.js 22+, tmux
- **Agent machine** (remote): Node.js 22+, tmux, network access to server
- Both machines on the same network (or with port forwarding to the server's port 9494)

### Step 1: Install the Server

On the server machine:

```bash
npx @lamalibre/create-shell
```

The installer:
1. Creates `~/.shell/` with a root CA and API key
2. Installs `shell-server` and `shell-agent` packages
3. Generates a one-time join token for agent enrollment
4. Sets up launchd (macOS) or systemd (Linux) services
5. Creates CLI config at `~/.shell-cli/config.json`

At the end, it prints a **join token**. Copy it — you will need it on the agent machine.

### Step 2: Enroll the Agent

On the remote machine:

```bash
npx @lamalibre/create-shell --join --server https://<server-ip>:9494 --token <join-token>
```

This:
1. Generates a keypair and CSR on the agent
2. Sends the CSR to the server for signing
3. Saves the signed certificate to `~/.shell-agent/`
4. Installs the agent daemon as a system service

The agent is now enrolled and polling the server every 10 seconds.

### Step 3: Enable Access and Connect

On the server machine:

```bash
# Enable shell for the agent (30 minutes)
shell enable <agent-label>

# Connect
shell connect <agent-label>
```

You are now in a remote terminal session. Press `Ctrl+]` to disconnect.

### Step 4: Explore

```bash
shell sessions         # View session audit log
shell config           # Check server configuration
shell policies         # List access policies
shell disable <label>  # Revoke access early
```

## Plugin Mode (Inside Portlama)

If you already run Portlama, Shell is available as a built-in feature — no separate server needed.

1. The shell plugin is registered in Portlama's Fastify instance
2. Agents enroll using Portlama's existing certificate infrastructure
3. Use the Portlama desktop app or panel to enable shell access for agents
4. Connect via the Portlama panel or `shell connect` with your admin certificate

The agent enrollment and daemon setup are the same as standalone mode, except the agent points to your Portlama server URL and uses a Portlama-issued certificate.

## Next Steps

- [Standalone Setup](../02-guides/standalone-setup.md) — detailed server and agent setup
- [Desktop App](../02-guides/desktop-app.md) — graphical management interface
- [Managing Policies](../02-guides/managing-policies.md) — IP allowlists, command blocklists, time limits
- [Security Model](../01-concepts/security-model.md) — how the 5-gate auth chain protects you
