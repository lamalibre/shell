#!/usr/bin/env bash
# ============================================================================
# 02-auth-chain — Auth Chain — Test each of the 5 gates individually
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "02-auth-chain — Auth Chain — Test each of the 5 gates individually"

# ---------------------------------------------------------------------------
log_section "Gate 1: Admin role required"
# ---------------------------------------------------------------------------

# No auth header at all → 401
NO_AUTH=$(curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
  "${BASE_URL}/api/shell/config" 2>/dev/null || echo "000")
assert_eq "$NO_AUTH" "401" "No auth → 401"

# Bad API key → 401
BAD_KEY=$(curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
  -H "Authorization: Bearer 0000000000000000000000000000000000000000000000000000000000000000" \
  "${BASE_URL}/api/shell/config" 2>/dev/null || echo "000")
assert_eq "$BAD_KEY" "401" "Invalid API key → 401"

# Valid admin key → 200
VALID=$(api_get_status "shell/config")
assert_eq "$VALID" "200" "Valid API key → 200"

# ---------------------------------------------------------------------------
log_section "Gate 2: Global shell enabled"
# ---------------------------------------------------------------------------

# Ensure shell is disabled first
api_patch "shell/config" '{"enabled":false}' > /dev/null

# Try to enable agent shell while global is disabled → 400
ENABLE_WHILE_DISABLED=$(api_post_status "shell/enable/test-agent" '{"durationMinutes":30}')
assert_eq "$ENABLE_WHILE_DISABLED" "400" "Enable agent while global disabled → 400"

# Now enable global
api_patch "shell/config" '{"enabled":true}' > /dev/null

CONFIG=$(api_get "shell/config")
assert_json_field "$CONFIG" '.enabled' 'true' "Global shell now enabled"

# ---------------------------------------------------------------------------
log_section "Gate 3: Agent cert exists and not revoked"
# ---------------------------------------------------------------------------

# Try to enable a non-existent agent → 404
ENABLE_NONEXISTENT=$(api_post_status "shell/enable/nonexistent-agent" '{"durationMinutes":30}')
assert_eq "$ENABLE_NONEXISTENT" "404" "Enable non-existent agent → 404"

# Check agent-status for non-existent agent → 404
STATUS_NONEXISTENT=$(api_get_status "shell/agent-status?label=nonexistent-agent")
assert_eq "$STATUS_NONEXISTENT" "404" "Agent status for non-existent agent → 404"

# Existing agent should succeed
ENABLE_RESP=$(api_post "shell/enable/test-agent" '{"durationMinutes":30}')
assert_json_field "$ENABLE_RESP" '.ok' 'true' "Enable existing agent → ok"
assert_json_field "$ENABLE_RESP" '.label' 'test-agent' "Enable returns correct label"
assert_json_field_not_empty "$ENABLE_RESP" '.shellEnabledUntil' "Enable returns expiry time"

# ---------------------------------------------------------------------------
log_section "Gate 4: Time window (shellEnabledUntil)"
# ---------------------------------------------------------------------------

# Agent should be enabled now
AGENT_STATUS=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$AGENT_STATUS" '.shellEnabled' 'true' "Agent shell is enabled after enable call"
assert_json_field "$AGENT_STATUS" '.globalEnabled' 'true' "Global enabled reflected in status"

# Disable the agent
api_delete "shell/enable/test-agent" > /dev/null

AGENT_STATUS_AFTER=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$AGENT_STATUS_AFTER" '.shellEnabled' 'false' "Agent shell disabled after disable call"

# ---------------------------------------------------------------------------
log_section "Gate 5: IP ACL (policy allowedIps/deniedIps)"
# ---------------------------------------------------------------------------

# Create a policy that denies localhost (our test source IP)
RESTRICTIVE_POLICY=$(api_post "shell/policies" '{
  "name": "Deny Localhost",
  "description": "Denies 127.0.0.1",
  "deniedIps": ["127.0.0.1"]
}')
RESTRICTIVE_ID=$(echo "$RESTRICTIVE_POLICY" | jq -r '.policy.id')
assert_not_eq "$RESTRICTIVE_ID" "null" "Created restrictive policy"

# Enable agent with the restrictive policy
api_post "shell/enable/test-agent" "{\"durationMinutes\":30,\"policyId\":\"$RESTRICTIVE_ID\"}" > /dev/null

# Verify the agent has the restrictive policy assigned
AGENT_WITH_POLICY=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$AGENT_WITH_POLICY" '.policyId' "$RESTRICTIVE_ID" "Agent has restrictive policy assigned"

# Clean up: disable agent and delete restrictive policy
api_delete "shell/enable/test-agent" > /dev/null
api_delete "shell/policies/$RESTRICTIVE_ID" > /dev/null

# ---------------------------------------------------------------------------
log_section "Validate label format"
# ---------------------------------------------------------------------------

# Labels with invalid characters should be rejected
BAD_LABEL_STATUS=$(api_post_status "shell/enable/UPPER_CASE" '{"durationMinutes":30}')
assert_eq "$BAD_LABEL_STATUS" "400" "Uppercase label rejected"

BAD_LABEL_STATUS2=$(api_post_status "shell/enable/has_underscore" '{"durationMinutes":30}')
assert_eq "$BAD_LABEL_STATUS2" "400" "Label with underscores rejected"

BAD_LABEL_STATUS3=$(api_post_status "shell/enable/has.dots" '{"durationMinutes":30}')
assert_eq "$BAD_LABEL_STATUS3" "400" "Label with dots rejected"

# Clean up: disable global shell
api_patch "shell/config" '{"enabled":false}' > /dev/null

end_test
