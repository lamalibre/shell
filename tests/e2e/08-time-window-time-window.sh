#!/usr/bin/env bash
# ============================================================================
# 08-time-window — Time Window — Expiry during session, extend, revoke
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "08-time-window — Time Window — Expiry during session, extend, revoke"

# ---------------------------------------------------------------------------
log_section "Setup"
# ---------------------------------------------------------------------------

api_patch "shell/config" '{"enabled":true}' > /dev/null
log_pass "Global shell enabled"

# ---------------------------------------------------------------------------
log_section "Enable with minimum duration (5 minutes)"
# ---------------------------------------------------------------------------

ENABLE_5M=$(api_post "shell/enable/test-agent" '{"durationMinutes":5}')
assert_json_field "$ENABLE_5M" '.ok' 'true' "Enable with 5 minutes succeeds"
assert_json_field_not_empty "$ENABLE_5M" '.shellEnabledUntil' "Has expiry timestamp"

EXPIRY_5M=$(echo "$ENABLE_5M" | jq -r '.shellEnabledUntil')
log_info "Expiry set to: $EXPIRY_5M"

# Verify agent status shows enabled
STATUS_5M=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$STATUS_5M" '.shellEnabled' 'true' "Agent reports enabled with 5m window"

# ---------------------------------------------------------------------------
log_section "Extend time window by re-enabling"
# ---------------------------------------------------------------------------

ENABLE_EXTENDED=$(api_post "shell/enable/test-agent" '{"durationMinutes":60}')
assert_json_field "$ENABLE_EXTENDED" '.ok' 'true' "Re-enable with 60 minutes succeeds"

EXPIRY_60M=$(echo "$ENABLE_EXTENDED" | jq -r '.shellEnabledUntil')

# The new expiry should be later than the 5-minute one
# Compare as ISO strings (lexicographic comparison works for ISO dates)
if [[ "$EXPIRY_60M" > "$EXPIRY_5M" ]]; then
  log_pass "Extended window is later than original ($EXPIRY_60M > $EXPIRY_5M)"
else
  log_fail "Extended window is not later: $EXPIRY_60M vs $EXPIRY_5M"
fi

# ---------------------------------------------------------------------------
log_section "Revoke access via disable"
# ---------------------------------------------------------------------------

DISABLE_RESP=$(api_delete "shell/enable/test-agent")
assert_json_field "$DISABLE_RESP" '.ok' 'true' "Disable succeeds"
assert_json_field "$DISABLE_RESP" '.label' 'test-agent' "Disable returns correct label"

# Verify agent status shows disabled
STATUS_DISABLED=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$STATUS_DISABLED" '.shellEnabled' 'false' "Agent reports disabled after revoke"

UNTIL_AFTER_DISABLE=$(echo "$STATUS_DISABLED" | jq -r '.shellEnabledUntil')
assert_eq "$UNTIL_AFTER_DISABLE" "null" "shellEnabledUntil is null after disable"

# ---------------------------------------------------------------------------
log_section "Re-enable after revoke"
# ---------------------------------------------------------------------------

ENABLE_AGAIN=$(api_post "shell/enable/test-agent" '{"durationMinutes":30}')
assert_json_field "$ENABLE_AGAIN" '.ok' 'true' "Re-enable after revoke succeeds"

STATUS_REENABLED=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$STATUS_REENABLED" '.shellEnabled' 'true' "Agent reports enabled after re-enable"

# ---------------------------------------------------------------------------
log_section "Enable with maximum duration (480 minutes = 8 hours)"
# ---------------------------------------------------------------------------

ENABLE_MAX=$(api_post "shell/enable/test-agent" '{"durationMinutes":480}')
assert_json_field "$ENABLE_MAX" '.ok' 'true' "Enable with max duration (480m) succeeds"

# ---------------------------------------------------------------------------
log_section "Duration validation"
# ---------------------------------------------------------------------------

# Below minimum (5 minutes)
BELOW_MIN_STATUS=$(api_post_status "shell/enable/test-agent" '{"durationMinutes":1}')
assert_eq "$BELOW_MIN_STATUS" "400" "Duration below 5 minutes returns 400"

# Above maximum (480 minutes)
ABOVE_MAX_STATUS=$(api_post_status "shell/enable/test-agent" '{"durationMinutes":1000}')
assert_eq "$ABOVE_MAX_STATUS" "400" "Duration above 480 minutes returns 400"

# Zero duration
ZERO_STATUS=$(api_post_status "shell/enable/test-agent" '{"durationMinutes":0}')
assert_eq "$ZERO_STATUS" "400" "Zero duration returns 400"

# Negative duration
NEG_STATUS=$(api_post_status "shell/enable/test-agent" '{"durationMinutes":-10}')
assert_eq "$NEG_STATUS" "400" "Negative duration returns 400"

# ---------------------------------------------------------------------------
log_section "Enable with non-existent policy"
# ---------------------------------------------------------------------------

BAD_POLICY_STATUS=$(api_post_status "shell/enable/test-agent" '{"durationMinutes":30,"policyId":"nonexistent-policy"}')
assert_eq "$BAD_POLICY_STATUS" "400" "Enable with non-existent policy returns 400"

# ---------------------------------------------------------------------------
log_section "Enable while global disabled"
# ---------------------------------------------------------------------------

# Disable global shell
api_patch "shell/config" '{"enabled":false}' > /dev/null

WHILE_DISABLED=$(api_post_status "shell/enable/test-agent" '{"durationMinutes":30}')
assert_eq "$WHILE_DISABLED" "400" "Enable while global disabled returns 400"

# ---------------------------------------------------------------------------
log_section "Agent status reflects global disabled"
# ---------------------------------------------------------------------------

# Re-enable global but verify the agent's time window was already set
api_patch "shell/config" '{"enabled":true}' > /dev/null

STATUS_WITH_GLOBAL=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$STATUS_WITH_GLOBAL" '.globalEnabled' 'true' "Global enabled reflected"
# Agent should still be enabled from the 480-minute window
assert_json_field "$STATUS_WITH_GLOBAL" '.shellEnabled' 'true' "Agent still has valid time window"

# ---------------------------------------------------------------------------
log_section "Disable non-existent agent"
# ---------------------------------------------------------------------------

DISABLE_NONEXISTENT=$(api_delete_status "shell/enable/nonexistent-agent")
assert_eq "$DISABLE_NONEXISTENT" "404" "Disable non-existent agent returns 404"

# ---------------------------------------------------------------------------
log_section "Cleanup"
# ---------------------------------------------------------------------------

api_delete "shell/enable/test-agent" > /dev/null
api_patch "shell/config" '{"enabled":false}' > /dev/null
log_pass "Cleaned up"

end_test
