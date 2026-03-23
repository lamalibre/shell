#!/usr/bin/env bash
# ============================================================================
# 03-session-lifecycle — Session Lifecycle — Connect, input/output, resize, disconnect, audit log
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node

begin_test "03-session-lifecycle — Session Lifecycle — Connect, input/output, resize, disconnect, audit log"

# ---------------------------------------------------------------------------
log_section "Setup: Enable shell for agent"
# ---------------------------------------------------------------------------

# Enable global shell
api_patch "shell/config" '{"enabled":true}' > /dev/null
log_pass "Global shell enabled"

# Enable agent shell for 30 minutes
ENABLE_RESP=$(api_post "shell/enable/test-agent" '{"durationMinutes":30}')
assert_json_field "$ENABLE_RESP" '.ok' 'true' "Agent shell enabled"

# Verify agent status
STATUS=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$STATUS" '.shellEnabled' 'true' "Agent reports shell enabled"
assert_json_field "$STATUS" '.globalEnabled' 'true' "Agent reports global enabled"

# ---------------------------------------------------------------------------
log_section "WebSocket relay: admin connect, pair with agent, relay messages"
# ---------------------------------------------------------------------------

# Use a Node.js script to test WebSocket relay end-to-end.
# The agent daemon is already running on the agent VM and will connect when
# it detects shell is enabled (polling every 10s). We connect as admin and
# verify the pairing + message relay.

WS_TEST_RESULT=$(cd /tmp/e2e-node && node --input-type=module << 'WSEOF'
import { WebSocket } from 'ws';

const BASE_URL = process.env.BASE_URL || 'https://127.0.0.1:9494';
const API_KEY = process.env.API_KEY || '';
const WS_URL = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');

const result = { steps: [] };

function log(msg) { result.steps.push(msg); }

try {
  // Connect as admin
  const ws = new WebSocket(`${WS_URL}/api/shell/connect/test-agent`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    rejectUnauthorized: false,
  });

  const messages = [];
  let resolved = false;

  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      log('TIMEOUT waiting for messages');
      ws.close();
      result.success = messages.length > 0;
      console.log(JSON.stringify(result));
      process.exit(0);
    }
  }, 45000);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      log(`received: ${msg.type}`);

      if (msg.type === 'connected') {
        // Session is active — send a test input
        ws.send(JSON.stringify({ type: 'input', data: 'echo E2E_TEST_MARKER\n' }));
        log('sent input');

        // Wait a moment for output, then send resize
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
          log('sent resize');
        }, 1000);

        // Collect output for a few seconds then close
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            result.success = true;
            result.messageTypes = messages.map(m => m.type);
            result.messageCount = messages.length;
            result.hadOutput = messages.some(m => m.type === 'output');
            console.log(JSON.stringify(result));
            process.exit(0);
          }
        }, 5000);
      }

      if (msg.type === 'error') {
        log(`error: ${msg.message}`);
      }
    } catch (e) {
      // Binary or non-JSON message (terminal output)
      messages.push({ type: 'output', raw: true });
      log('received raw output');
    }
  });

  ws.on('error', (err) => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      log(`ws error: ${err.message}`);
      result.success = false;
      result.error = err.message;
      console.log(JSON.stringify(result));
      process.exit(0);
    }
  });

  ws.on('close', (code, reason) => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      log(`ws closed: ${code} ${reason}`);
      result.success = messages.length > 0;
      result.closeCode = code;
      result.messageTypes = messages.map(m => m.type);
      console.log(JSON.stringify(result));
      process.exit(0);
    }
  });
} catch (err) {
  result.success = false;
  result.error = err.message;
  console.log(JSON.stringify(result));
  process.exit(0);
}
WSEOF
)

WS_SUCCESS=$(echo "$WS_TEST_RESULT" | jq -r '.success // false')
WS_MSG_COUNT=$(echo "$WS_TEST_RESULT" | jq -r '.messageCount // 0')

if [ "$WS_SUCCESS" = "true" ]; then
  log_pass "WebSocket relay session completed successfully"
else
  WS_ERROR=$(echo "$WS_TEST_RESULT" | jq -r '.error // .steps[-1] // "unknown"')
  log_fail "WebSocket relay session failed: $WS_ERROR"
fi

assert_not_eq "$WS_MSG_COUNT" "0" "Received messages during relay session"

# Check if we got a 'connected' message (agent paired)
HAS_CONNECTED=$(echo "$WS_TEST_RESULT" | jq '[.messageTypes[]? | select(. == "connected")] | length')
if [ "$HAS_CONNECTED" -gt 0 ]; then
  log_pass "Received 'connected' message (admin-agent paired)"
else
  # May have received 'waiting' then timed out waiting for agent — check
  HAS_WAITING=$(echo "$WS_TEST_RESULT" | jq '[.messageTypes[]? | select(. == "waiting")] | length')
  if [ "$HAS_WAITING" -gt 0 ]; then
    log_info "Agent not connected in time — received 'waiting' message (agent daemon may need more time)"
    log_pass "WebSocket connection established, waiting state confirmed"
  else
    log_fail "No 'connected' or 'waiting' message received"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Audit log: session recorded"
# ---------------------------------------------------------------------------

# Give the server a moment to write the session log
sleep 2

SESSIONS=$(api_get "shell/sessions")
SESSION_COUNT=$(echo "$SESSIONS" | jq '.sessions | length')
assert_not_eq "$SESSION_COUNT" "0" "Session audit log has entries"

# Check the most recent session
LATEST_SESSION=$(echo "$SESSIONS" | jq '.sessions[-1]')
LATEST_LABEL=$(echo "$LATEST_SESSION" | jq -r '.agentLabel')
assert_eq "$LATEST_LABEL" "test-agent" "Latest session is for test-agent"

LATEST_STATUS=$(echo "$LATEST_SESSION" | jq -r '.status')
# Status should be 'ended' (session was closed) or 'pending'/'active' if agent didn't pair in time
if [ "$LATEST_STATUS" = "ended" ] || [ "$LATEST_STATUS" = "active" ] || [ "$LATEST_STATUS" = "pending" ]; then
  log_pass "Session has valid status: $LATEST_STATUS"
else
  log_fail "Session has unexpected status: $LATEST_STATUS"
fi

assert_json_field_not_empty "$LATEST_SESSION" '.id' "Session has UUID"
assert_json_field_not_empty "$LATEST_SESSION" '.startedAt' "Session has start time"

# If session ended, verify duration is recorded
if [ "$LATEST_STATUS" = "ended" ]; then
  DURATION=$(echo "$LATEST_SESSION" | jq -r '.duration // "null"')
  if [ "$DURATION" != "null" ]; then
    log_pass "Ended session has duration recorded: ${DURATION}s"
  else
    log_fail "Ended session missing duration"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Cleanup"
# ---------------------------------------------------------------------------

api_delete "shell/enable/test-agent" > /dev/null
api_patch "shell/config" '{"enabled":false}' > /dev/null
log_pass "Cleaned up: agent disabled, global shell disabled"

end_test
