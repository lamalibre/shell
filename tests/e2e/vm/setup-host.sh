#!/usr/bin/env bash
# ============================================================================
# Shell E2E — Host VM Setup
# ============================================================================
# Installs Node.js 22, pnpm, builds the shell project, runs standalone server
# setup via create-shell, and extracts credentials for the agent VM.
#
# Prerequisites: Ubuntu 24.04 VM with project transferred to /opt/shell/project
# Outputs: /tmp/shell-test-credentials.json
# ============================================================================
set -euo pipefail

echo "[1/8] Installing Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
node --version

echo "[2/8] Installing pnpm..."
sudo npm install -g pnpm@9
pnpm --version

echo "[3/8] Installing tmux and jq..."
sudo apt-get install -y tmux jq
tmux -V

# Install ws module for E2E WebSocket tests
mkdir -p /tmp/e2e-node
echo '{"type":"module","dependencies":{"ws":"^8.20.0"}}' > /tmp/e2e-node/package.json
cd /tmp/e2e-node && npm install --silent
cd /

echo "[4/8] Installing project dependencies..."
cd /opt/shell/project
pnpm install --frozen-lockfile

echo "[5/8] Building all packages..."
pnpm build

echo "[6/8] Setting up shell-server via create-shell..."
# Create the state directory manually and run the server directly
# (We skip the installer's interactive prompts and do it programmatically)

STATE_DIR="$HOME/.shell"
mkdir -p "$STATE_DIR/logs" && chmod 700 "$STATE_DIR"

# Create a minimal package.json for npm installs
cat > "$STATE_DIR/package.json" << 'PKGJSON'
{ "name": "shell-local", "private": true, "type": "module" }
PKGJSON

# Link built packages instead of npm install (we already have them built)
SHELL_SERVER="/opt/shell/project/packages/shell-server/dist/standalone.js"
SHELL_AGENT_CLI="/opt/shell/project/packages/shell-agent/dist/cli.js"

# Determine host IP for cert SANs (so remote agents can connect via IP)
HOST_IP=$(hostname -I | awk '{print $1}')
echo "  Host IP: $HOST_IP"

# Start server temporarily to generate CA + API key (with host IP in cert SANs)
echo "  Starting temporary server for CA generation..."
node -e "
import('$SHELL_SERVER').then(m =>
  m.startStandaloneServer({ port: 9494, host: '0.0.0.0', stateDir: '$STATE_DIR', tunnelHostname: '$HOST_IP' })
)" &
SERVER_PID=$!

# Wait for server health
for i in $(seq 1 30); do
  if curl -sk https://127.0.0.1:9494/api/shell/health 2>/dev/null | grep -q '"ok"'; then
    echo "  Server healthy after ${i}s"
    break
  fi
  sleep 1
done

# Read API key
API_KEY=$(cat "$STATE_DIR/api-key")
echo "  API key generated"

echo "[7/8] Creating join token for agent..."
TOKEN_RESP=$(curl -sk -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"test-agent","ttlMinutes":60}' \
  "https://127.0.0.1:9494/api/shell/tokens")

JOIN_TOKEN=$(echo "$TOKEN_RESP" | jq -r '.token')
echo "  Join token created"

# Kill temporary server
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
sleep 1

echo "[8/8] Installing systemd service..."
# Create systemd service for shell-server
sudo mkdir -p /etc/systemd/system
sudo tee /etc/systemd/system/shell-server.service > /dev/null << EOF
[Unit]
Description=Shell Server
After=network.target

[Service]
Type=simple
User=$(whoami)
ExecStart=$(which node) $SHELL_SERVER
Environment=NODE_ENV=production
Environment=SHELL_STATE_DIR=$STATE_DIR
WorkingDirectory=/opt/shell/project
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Start shell-server via node directly (systemd service uses the built dist)
# We need a small wrapper that calls startStandaloneServer
WRAPPER="$STATE_DIR/start-server.js"
cat > "$WRAPPER" << JSEOF
import { startStandaloneServer } from '$SHELL_SERVER';
await startStandaloneServer({ port: 9494, host: '0.0.0.0', stateDir: '$STATE_DIR', tunnelHostname: '$HOST_IP' });
JSEOF

sudo sed -i "s|ExecStart=.*|ExecStart=$(which node) $WRAPPER|" /etc/systemd/system/shell-server.service

sudo systemctl daemon-reload
sudo systemctl enable --now shell-server

# Wait for service to be healthy
for i in $(seq 1 15); do
  if curl -sk https://127.0.0.1:9494/api/shell/health 2>/dev/null | grep -q '"ok"'; then
    echo "  Service healthy"
    break
  fi
  sleep 1
done

# Write credentials file
cat > /tmp/shell-test-credentials.json << CREDS
{
  "hostIp": "$HOST_IP",
  "apiKey": "$API_KEY",
  "joinToken": "$JOIN_TOKEN",
  "agentLabel": "test-agent",
  "serverUrl": "https://$HOST_IP:9494",
  "stateDir": "$STATE_DIR",
  "caCertPath": "$STATE_DIR/ca.crt"
}
CREDS

echo ""
echo "Host setup complete!"
echo "  Server URL: https://$HOST_IP:9494"
echo "  API Key: $API_KEY"
echo "  Join Token: $JOIN_TOKEN"
echo "  Credentials: /tmp/shell-test-credentials.json"
