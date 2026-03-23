#!/usr/bin/env bash
# ============================================================================
# 07-concurrent-sessions — Concurrent Sessions — Multiple agents, conflict rejection 4409
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node

begin_test "07-concurrent-sessions — Concurrent Sessions — Multiple agents, conflict rejection 4409"

# ---------------------------------------------------------------------------
log_section "Setup: Enable shell for agent"
# ---------------------------------------------------------------------------

api_patch "shell/config" '{"enabled":true}' > /dev/null
api_post "shell/enable/test-agent" '{"durationMinutes":30}' > /dev/null
log_pass "Shell enabled for test-agent"

# ---------------------------------------------------------------------------
log_section "Two admin connections to same agent — second gets 4409"
# ---------------------------------------------------------------------------

# Test: Open first admin WebSocket, keep it alive, then try to open a second.
# The second should receive close code 4409 (session already active).
CONCURRENT_RESULT=$(cd /tmp/e2e-node && node --input-type=module << 'WSEOF'
import { WebSocket } from 'ws';

const BASE_URL = process.env.BASE_URL || 'https://127.0.0.1:9494';
const API_KEY = process.env.API_KEY || '';
const WS_URL = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');
const CONNECT_URL = `${WS_URL}/api/shell/connect/test-agent`;
const WS_OPTS = {
  headers: { 'Authorization': `Bearer ${API_KEY}` },
  rejectUnauthorized: false,
};

const result = {};

try {
  // Open first admin connection
  const ws1 = new WebSocket(CONNECT_URL, WS_OPTS);

  let ws1Ready = false;

  const globalTimeout = setTimeout(() => {
    result.timeout = true;
    result.ws1Ready = ws1Ready;
    try { ws1.close(); } catch {}
    console.log(JSON.stringify(result));
    process.exit(0);
  }, 45000);

  ws1.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'connected' || msg.type === 'waiting') {
        ws1Ready = true;

        // First connection is established/waiting — now try second
        const ws2 = new WebSocket(CONNECT_URL, WS_OPTS);

        ws2.on('message', (data2) => {
          try {
            const msg2 = JSON.parse(data2.toString());
            result.ws2Message = msg2;
          } catch {}
        });

        ws2.on('close', (code, reason) => {
          result.ws2CloseCode = code;
          result.ws2CloseReason = reason?.toString() || '';

          // Now clean up ws1
          clearTimeout(globalTimeout);
          try { ws1.close(); } catch {}
          result.success = true;
          console.log(JSON.stringify(result));
          process.exit(0);
        });

        ws2.on('error', (err) => {
          result.ws2Error = err.message;
        });
      }
    } catch {}
  });

  ws1.on('error', (err) => {
    result.ws1Error = err.message;
  });

  ws1.on('close', (code) => {
    if (!result.success) {
      clearTimeout(globalTimeout);
      result.ws1CloseCode = code;
      result.success = false;
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

CONCURRENT_OK=$(echo "$CONCURRENT_RESULT" | jq -r '.success // false')
WS2_CODE=$(echo "$CONCURRENT_RESULT" | jq -r '.ws2CloseCode // "none"')

if [ "$CONCURRENT_OK" = "true" ]; then
  log_pass "Concurrent session test completed"
else
  TIMEOUT=$(echo "$CONCURRENT_RESULT" | jq -r '.timeout // false')
  if [ "$TIMEOUT" = "true" ]; then
    log_info "Timeout — agent may not have connected in time"
  fi
fi

assert_eq "$WS2_CODE" "4409" "Second admin connection receives close code 4409 (session already active)"

# Verify the error message from ws2
WS2_MSG_TYPE=$(echo "$CONCURRENT_RESULT" | jq -r '.ws2Message.type // "none"')
assert_eq "$WS2_MSG_TYPE" "error" "Second connection receives error message"

WS2_MSG_TEXT=$(echo "$CONCURRENT_RESULT" | jq -r '.ws2Message.message // ""')
assert_contains "$WS2_MSG_TEXT" "already active" "Error message mentions session already active"

# ---------------------------------------------------------------------------
log_section "After conflict: first session audit logged"
# ---------------------------------------------------------------------------

sleep 2

SESSIONS=$(api_get "shell/sessions")
RECENT=$(echo "$SESSIONS" | jq '[.sessions[] | select(.agentLabel == "test-agent")] | last')
RECENT_STATUS=$(echo "$RECENT" | jq -r '.status // "none"')

# The first session should have been created (pending, active, or ended)
if [ "$RECENT_STATUS" = "pending" ] || [ "$RECENT_STATUS" = "active" ] || [ "$RECENT_STATUS" = "ended" ]; then
  log_pass "Session audit entry exists with status: $RECENT_STATUS"
else
  log_fail "Expected valid session status, got: $RECENT_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Cleanup"
# ---------------------------------------------------------------------------

api_delete "shell/enable/test-agent" > /dev/null
api_patch "shell/config" '{"enabled":false}' > /dev/null
log_pass "Cleaned up"

end_test
