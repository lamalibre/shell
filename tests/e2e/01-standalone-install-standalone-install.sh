#!/usr/bin/env bash
# ============================================================================
# 01-standalone-install — Standalone Install — Fresh server install, CA generation, /health
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "01-standalone-install — Standalone Install — Fresh server install, CA generation, /health"

# ---------------------------------------------------------------------------
log_section "Health endpoint"
# ---------------------------------------------------------------------------

HEALTH=$(api_get "shell/health" 2>/dev/null || echo '{}')
assert_json_field "$HEALTH" '.status' 'ok' "GET /health returns status ok"

STATUS=$(api_get_status "shell/health")
assert_eq "$STATUS" "200" "GET /health returns HTTP 200"

# ---------------------------------------------------------------------------
log_section "Authentication"
# ---------------------------------------------------------------------------

# Request without auth should be rejected
NO_AUTH_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
  "${BASE_URL}/api/shell/config" 2>/dev/null || echo "000")
assert_eq "$NO_AUTH_STATUS" "401" "Request without auth returns 401"

# Request with invalid API key should be rejected
BAD_AUTH_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
  -H "Authorization: Bearer invalid-key-000000000000000000000000" \
  "${BASE_URL}/api/shell/config" 2>/dev/null || echo "000")
assert_eq "$BAD_AUTH_STATUS" "401" "Request with invalid API key returns 401"

# Request with valid API key should succeed
CONFIG_STATUS=$(api_get_status "shell/config")
assert_eq "$CONFIG_STATUS" "200" "Request with valid API key returns 200"

# ---------------------------------------------------------------------------
log_section "Server configuration defaults"
# ---------------------------------------------------------------------------

CONFIG=$(api_get "shell/config")
assert_json_field "$CONFIG" '.enabled' 'false' "Shell is disabled by default"
assert_json_field "$CONFIG" '.defaultPolicy' 'default' "Default policy is 'default'"

POLICY_COUNT=$(echo "$CONFIG" | jq '.policies | length')
assert_eq "$POLICY_COUNT" "1" "One policy exists by default"

POLICY_NAME=$(echo "$CONFIG" | jq -r '.policies[0].name')
assert_eq "$POLICY_NAME" "Default" "Default policy is named 'Default'"

POLICY_ID=$(echo "$CONFIG" | jq -r '.policies[0].id')
assert_eq "$POLICY_ID" "default" "Default policy has id 'default'"

# Verify blocklist is populated
HARD_BLOCKED=$(echo "$CONFIG" | jq '.policies[0].commandBlocklist.hardBlocked | length')
assert_not_eq "$HARD_BLOCKED" "0" "Default policy has hard-blocked commands"

RESTRICTED=$(echo "$CONFIG" | jq '.policies[0].commandBlocklist.restricted | length')
assert_not_eq "$RESTRICTED" "0" "Default policy has restricted commands"

# ---------------------------------------------------------------------------
log_section "Agent enrollment"
# ---------------------------------------------------------------------------

# List agents — the test-agent should already be enrolled by VM setup
AGENTS=$(api_get "shell/agents")
AGENT_COUNT=$(echo "$AGENTS" | jq '.agents | length')
assert_not_eq "$AGENT_COUNT" "0" "At least one agent is enrolled"

AGENT_LABEL=$(echo "$AGENTS" | jq -r '.agents[0].label')
assert_eq "$AGENT_LABEL" "test-agent" "Enrolled agent has label 'test-agent'"

AGENT_REVOKED=$(echo "$AGENTS" | jq -r '.agents[0].revoked')
assert_eq "$AGENT_REVOKED" "false" "Enrolled agent is not revoked"

# ---------------------------------------------------------------------------
log_section "Token creation"
# ---------------------------------------------------------------------------

# Create a join token
TOKEN_RESP=$(api_post "shell/tokens" '{"label":"token-test-agent","ttlMinutes":10}')
assert_json_field_not_empty "$TOKEN_RESP" '.token' "Token creation returns a token"
assert_json_field "$TOKEN_RESP" '.label' 'token-test-agent' "Token has correct label"
assert_json_field_not_empty "$TOKEN_RESP" '.expiresAt' "Token has expiration time"

# Invalid token creation should fail
BAD_TOKEN_STATUS=$(api_post_status "shell/tokens" '{"label":"INVALID LABEL"}')
assert_eq "$BAD_TOKEN_STATUS" "400" "Invalid label rejected for token creation"

# ---------------------------------------------------------------------------
log_section "Sessions endpoint (empty)"
# ---------------------------------------------------------------------------

SESSIONS=$(api_get "shell/sessions")
SESSIONS_TYPE=$(echo "$SESSIONS" | jq -r 'type')
assert_eq "$SESSIONS_TYPE" "object" "Sessions response is an object"

SESSION_LIST=$(echo "$SESSIONS" | jq '.sessions')
SESSION_TYPE=$(echo "$SESSION_LIST" | jq -r 'type')
assert_eq "$SESSION_TYPE" "array" "Sessions list is an array"

end_test
