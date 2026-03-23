#!/usr/bin/env bash
# ============================================================================
# Shell E2E — Agent VM Setup
# ============================================================================
# Installs Node.js 22, tmux, pnpm, builds the project, enrolls the agent
# with the host server, and starts the agent daemon.
#
# Prerequisites:
#   - Ubuntu 24.04 VM with project transferred to /opt/shell/project
#   - /tmp/shell-agent-credentials.json with { serverUrl, joinToken, agentLabel, caCertPath }
#   - /tmp/ca.crt transferred from host
# ============================================================================
set -euo pipefail

echo "[1/6] Installing Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
node --version

echo "[2/6] Installing pnpm and tmux..."
sudo npm install -g pnpm@9
sudo apt-get install -y tmux jq
pnpm --version
tmux -V

echo "[3/6] Installing project dependencies and building..."
cd /opt/shell/project
pnpm install --frozen-lockfile
pnpm build

echo "[4/6] Reading credentials..."
CREDS_FILE="/tmp/shell-agent-credentials.json"
if [ ! -f "$CREDS_FILE" ]; then
  echo "ERROR: Credentials file not found at $CREDS_FILE"
  exit 1
fi

SERVER_URL=$(jq -r '.serverUrl' "$CREDS_FILE")
JOIN_TOKEN=$(jq -r '.joinToken' "$CREDS_FILE")
AGENT_LABEL=$(jq -r '.agentLabel' "$CREDS_FILE")

echo "  Server URL: $SERVER_URL"
echo "  Agent Label: $AGENT_LABEL"

echo "[5/6] Enrolling agent with server..."
AGENT_CLI="/opt/shell/project/packages/shell-agent/dist/cli.js"
AGENT_DIR="$HOME/.shell-agent"
mkdir -p "$AGENT_DIR" && chmod 700 "$AGENT_DIR"

# Copy CA cert from host for TLS verification
if [ -f /tmp/ca.crt ]; then
  cp /tmp/ca.crt "$AGENT_DIR/ca.crt"
  echo "  CA cert installed"
fi

# Run enrollment with explicit flags
NODE_TLS_REJECT_UNAUTHORIZED=0 node "$AGENT_CLI" enroll \
  --server "$SERVER_URL" \
  --token "$JOIN_TOKEN" \
  --label "$AGENT_LABEL"

echo "  Agent enrolled successfully"

echo "[6/6] Installing systemd service for agent..."
SERVE_WRAPPER="$AGENT_DIR/start-agent.sh"
cat > "$SERVE_WRAPPER" << 'AGENTEOF'
#!/usr/bin/env bash
exec node /opt/shell/project/packages/shell-agent/dist/cli.js serve
AGENTEOF
chmod +x "$SERVE_WRAPPER"

sudo tee /etc/systemd/system/shell-agent.service > /dev/null << EOF
[Unit]
Description=Shell Agent
After=network.target

[Service]
Type=simple
User=$(whoami)
ExecStart=$SERVE_WRAPPER
WorkingDirectory=/opt/shell/project
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now shell-agent

# Verify agent is running
sleep 3
if systemctl is-active --quiet shell-agent; then
  echo "  Agent service running"
else
  echo "  Warning: Agent service may not be running"
  sudo systemctl status shell-agent --no-pager || true
fi

echo ""
echo "Agent setup complete!"
echo "  Agent label: $AGENT_LABEL"
echo "  Server: $SERVER_URL"
