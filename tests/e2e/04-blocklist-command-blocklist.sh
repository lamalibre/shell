#!/usr/bin/env bash
# ============================================================================
# 04-blocklist — Command Blocklist — Hard-blocked rejected, restricted rejected, allowed pass
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "04-blocklist — Command Blocklist — Hard-blocked rejected, restricted rejected, allowed pass"

# ---------------------------------------------------------------------------
log_section "Setup: Enable shell for agent"
# ---------------------------------------------------------------------------

api_patch "shell/config" '{"enabled":true}' > /dev/null
api_post "shell/enable/test-agent" '{"durationMinutes":30}' > /dev/null
log_pass "Shell enabled for test-agent"

# ---------------------------------------------------------------------------
log_section "Default policy blocklist via agent-status"
# ---------------------------------------------------------------------------

AGENT_STATUS=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$AGENT_STATUS" '.policyId' 'default' "Agent uses default policy"

# Verify commandBlocklist is present
BLOCKLIST=$(echo "$AGENT_STATUS" | jq '.commandBlocklist')
assert_not_eq "$BLOCKLIST" "null" "Command blocklist is present in agent status"

# Verify hard-blocked commands
HARD_BLOCKED=$(echo "$BLOCKLIST" | jq '.hardBlocked')
HARD_COUNT=$(echo "$HARD_BLOCKED" | jq 'length')
assert_not_eq "$HARD_COUNT" "0" "Hard-blocked list is non-empty"

# Check specific hard-blocked commands from default policy
assert_contains "$HARD_BLOCKED" "rm -rf /" "rm -rf / is hard-blocked"
assert_contains "$HARD_BLOCKED" "mkfs" "mkfs is hard-blocked"
assert_contains "$HARD_BLOCKED" "shutdown" "shutdown is hard-blocked"
assert_contains "$HARD_BLOCKED" "reboot" "reboot is hard-blocked"

# Verify restricted commands
RESTRICTED=$(echo "$BLOCKLIST" | jq '.restricted')
RESTRICTED_COUNT=$(echo "$RESTRICTED" | jq 'length')
assert_not_eq "$RESTRICTED_COUNT" "0" "Restricted commands list is non-empty"

# Check specific restricted commands
SUDO_RESTRICTED=$(echo "$RESTRICTED" | jq -r '.sudo')
assert_eq "$SUDO_RESTRICTED" "false" "sudo is restricted (blocked)"

SU_RESTRICTED=$(echo "$RESTRICTED" | jq -r '.su')
assert_eq "$SU_RESTRICTED" "false" "su is restricted (blocked)"

SYSTEMCTL_RESTRICTED=$(echo "$RESTRICTED" | jq -r '.systemctl')
assert_eq "$SYSTEMCTL_RESTRICTED" "false" "systemctl is restricted (blocked)"

# ---------------------------------------------------------------------------
log_section "Custom policy with modified blocklist"
# ---------------------------------------------------------------------------

# Create a policy with custom blocklist
CUSTOM_POLICY=$(api_post "shell/policies" '{
  "name": "Custom Blocklist",
  "description": "Custom policy with extra blocked commands",
  "commandBlocklist": {
    "hardBlocked": ["rm -rf /", "format c:"],
    "restricted": {
      "sudo": false,
      "docker": false,
      "apt-get": true
    }
  }
}')
CUSTOM_ID=$(echo "$CUSTOM_POLICY" | jq -r '.policy.id')
assert_not_eq "$CUSTOM_ID" "null" "Created custom blocklist policy"

# Verify the custom policy was stored correctly
CUSTOM_BLOCKLIST=$(echo "$CUSTOM_POLICY" | jq '.policy.commandBlocklist')

# Custom hard-blocked should include our additions
CUSTOM_HARD=$(echo "$CUSTOM_BLOCKLIST" | jq '.hardBlocked')
assert_contains "$CUSTOM_HARD" "format c:" "Custom hard-blocked includes 'format c:'"

# Custom restricted should include our additions
CUSTOM_RESTRICTED=$(echo "$CUSTOM_BLOCKLIST" | jq '.restricted')
DOCKER_VAL=$(echo "$CUSTOM_RESTRICTED" | jq -r '.docker')
assert_eq "$DOCKER_VAL" "false" "docker is restricted in custom policy"

APTGET_VAL=$(echo "$CUSTOM_RESTRICTED" | jq -r '."apt-get"')
assert_eq "$APTGET_VAL" "true" "apt-get is allowed in custom policy"

# ---------------------------------------------------------------------------
log_section "Apply custom policy to agent"
# ---------------------------------------------------------------------------

# Re-enable agent with custom policy
api_delete "shell/enable/test-agent" > /dev/null
api_post "shell/enable/test-agent" "{\"durationMinutes\":30,\"policyId\":\"$CUSTOM_ID\"}" > /dev/null

AGENT_CUSTOM=$(api_get "shell/agent-status?label=test-agent")
assert_json_field "$AGENT_CUSTOM" '.policyId' "$CUSTOM_ID" "Agent now uses custom policy"

AGENT_BLOCKLIST=$(echo "$AGENT_CUSTOM" | jq '.commandBlocklist')
assert_not_eq "$AGENT_BLOCKLIST" "null" "Custom policy blocklist served to agent"

# Verify the custom blocklist comes through
AGENT_DOCKER=$(echo "$AGENT_BLOCKLIST" | jq -r '.restricted.docker')
assert_eq "$AGENT_DOCKER" "false" "Agent receives docker=restricted from custom policy"

# ---------------------------------------------------------------------------
log_section "Policy without blocklist inherits defaults"
# ---------------------------------------------------------------------------

# Create a minimal policy (no commandBlocklist specified)
MINIMAL_POLICY=$(api_post "shell/policies" '{
  "name": "Minimal Policy",
  "description": "Policy with default blocklist"
}')
MINIMAL_ID=$(echo "$MINIMAL_POLICY" | jq -r '.policy.id')
assert_not_eq "$MINIMAL_ID" "null" "Created minimal policy"

# The create response stores hardBlocked as [] (explicit empty).
# On read-back, mergePolicyWithDefaults merges restricted commands from defaults,
# but hardBlocked stays empty (explicit empty array overrides defaults in spread).
POLICIES_READ=$(api_get "shell/policies")
MINIMAL_READ=$(echo "$POLICIES_READ" | jq --arg id "$MINIMAL_ID" '[.policies[] | select(.id == $id)] | .[0]')

# restricted inherits defaults via deep merge
MINIMAL_RESTRICTED=$(echo "$MINIMAL_READ" | jq '.commandBlocklist.restricted | length')
assert_not_eq "$MINIMAL_RESTRICTED" "0" "Minimal policy inherits default restricted commands on read"

# hardBlocked stays empty (explicit [] overrides default in spread)
MINIMAL_HARD=$(echo "$MINIMAL_READ" | jq '.commandBlocklist.hardBlocked | length')
assert_eq "$MINIMAL_HARD" "0" "Minimal policy hardBlocked is empty (explicit empty array)"

# ---------------------------------------------------------------------------
log_section "Cleanup"
# ---------------------------------------------------------------------------

api_delete "shell/enable/test-agent" > /dev/null
api_delete "shell/policies/$CUSTOM_ID" > /dev/null
api_delete "shell/policies/$MINIMAL_ID" > /dev/null
api_patch "shell/config" '{"enabled":false}' > /dev/null
log_pass "Cleaned up policies and disabled shell"

end_test
