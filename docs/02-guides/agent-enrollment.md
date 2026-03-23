# Agent Enrollment

> Enroll a remote machine as a shell agent so it can accept terminal sessions through the relay.

## Prerequisites

- Node.js 22+ on the agent machine
- tmux installed (`apt install tmux` on Ubuntu, `brew install tmux` on macOS)
- Network access to the shell server (standalone: port 9494, plugin: Portlama's port)
- A valid join token from the server admin

## Standalone Enrollment

### Step 1: Get a Join Token

On the server machine (or via the desktop app), create a one-time enrollment token:

```bash
# Via CLI (if the server is local)
curl -sk -H "Authorization: Bearer $(cat ~/.shell/api-key)" \
  -X POST https://localhost:9494/api/shell/tokens \
  -H "Content-Type: application/json" \
  -d '{"label": "office-ubuntu"}'
```

The token is valid for 10 minutes by default. The installer creates one automatically during setup (valid for 60 minutes).

### Step 2: Enroll the Agent

On the remote machine:

```bash
npx @lamalibre/create-shell --join --server https://<server-ip>:9494 --token <token>
```

Or non-interactively:

```bash
npx @lamalibre/create-shell --join \
  --server https://192.168.1.100:9494 \
  --token abc123def456 \
  --label office-ubuntu
```

This:
1. Creates `~/.shell-agent/` with mode `0700`
2. Installs `@lamalibre/shell-agent`
3. Generates an RSA 2048 keypair and CSR with `CN=agent:office-ubuntu`
4. Sends the CSR to the server: `POST /api/shell/enroll`
5. Receives the signed certificate and CA certificate
6. Saves credentials:
   - `~/.shell-agent/cert.pem` (signed certificate, `0644`)
   - `~/.shell-agent/key.pem` (private key, `0600`)
   - `~/.shell-agent/ca.crt` (server CA, `0644`)
   - `~/.shell-agent/agent.json` (config, `0600`)
7. Installs the agent daemon as a system service

### Step 3: Verify

The agent starts polling the server immediately:

```bash
# Check the service
systemctl --user status shell-agent    # Linux
launchctl list | grep shell-agent      # macOS

# Check connectivity (from the server)
shell enable office-ubuntu
shell connect office-ubuntu
```

## Plugin Enrollment (Portlama)

In plugin mode, the agent enrolls through Portlama's existing certificate infrastructure:

1. Generate an agent certificate from the Portlama panel (Certificates > Create Agent)
2. Download the P12 bundle to the agent machine
3. Configure the agent to point to Portlama:

```json
// ~/.shell-agent/agent.json
{
  "mode": "plugin",
  "panelUrl": "https://panel.example.com",
  "authMethod": "p12",
  "p12Path": "/path/to/agent.p12",
  "label": "office-ubuntu"
}
```

4. Start the agent: `shell-agent serve`

The agent extracts PEM credentials from the P12 bundle on each start, using the `SHELL_AGENT_P12_PASS` environment variable for the password.

## Agent File Layout

After enrollment, the agent directory contains:

```
~/.shell-agent/
├── agent.json              # Configuration (mode, server URL, label)
├── cert.pem                # Client certificate (standalone)
├── key.pem                 # Private key (0600) (standalone)
├── ca.crt                  # Server CA certificate (standalone)
├── shell-wrapper.sh        # Command blocklist wrapper (0755)
├── shell-blocklist.json    # Command blocklist (synced from policy)
├── shell-history.log       # Command execution log
├── recordings/             # Session recordings
│   └── <uuid>.log          # One file per session
└── .pem/                   # Temporary P12 extraction (plugin mode)
```

## Agent CLI Commands

```bash
shell-agent serve                    # Start daemon (polls server)
shell-agent connect <label>          # Interactive client (admin use)
shell-agent enroll --server --token  # Enrollment
shell-agent log [label]              # View sessions
shell-agent --version                # Show version
```

## Troubleshooting

**Agent cannot reach server:**
- Verify network connectivity: `curl -sk https://<server>:9494/api/shell/health`
- Check firewall rules on the server machine

**Enrollment fails with "token not found":**
- Tokens are single-use and expire after 10 minutes
- Create a new token and try again

**Agent polls but never connects:**
- Shell access must be enabled: `shell enable <label>`
- Check that global shell is enabled: `shell config`

## Related Documentation

- [Standalone Setup](standalone-setup.md) — server installation
- [Security Model](../01-concepts/security-model.md) — certificate authentication
- [Shell Agent](../03-architecture/shell-agent.md) — agent daemon internals
