#!/usr/bin/env bash
# ============================================================================
# 06-policy-crud — Policy CRUD — Create, update, delete, IP allowlist/denylist
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "06-policy-crud — Policy CRUD — Create, update, delete, IP allowlist/denylist"

# ---------------------------------------------------------------------------
log_section "List policies (default state)"
# ---------------------------------------------------------------------------

POLICIES=$(api_get "shell/policies")
POLICY_COUNT=$(echo "$POLICIES" | jq '.policies | length')
assert_eq "$POLICY_COUNT" "1" "One default policy exists"

DEFAULT_POLICY=$(echo "$POLICIES" | jq -r '.defaultPolicy')
assert_eq "$DEFAULT_POLICY" "default" "Default policy ID is 'default'"

# ---------------------------------------------------------------------------
log_section "Create a new policy"
# ---------------------------------------------------------------------------

CREATE_RESP=$(api_post "shell/policies" '{
  "name": "Staging Access",
  "description": "Limited access for staging servers",
  "allowedIps": ["192.168.1.0/24", "10.0.0.1"],
  "deniedIps": ["192.168.1.100"],
  "inactivityTimeout": 300,
  "maxFileSize": 52428800,
  "commandBlocklist": {
    "hardBlocked": ["rm -rf /", "format c:"],
    "restricted": {"sudo": false, "docker": false}
  }
}')
assert_json_field "$CREATE_RESP" '.ok' 'true' "Policy creation succeeds"

POLICY=$(echo "$CREATE_RESP" | jq '.policy')
POLICY_ID=$(echo "$POLICY" | jq -r '.id')
assert_eq "$POLICY_ID" "staging-access" "Policy ID auto-derived from name as slug"

assert_json_field "$POLICY" '.name' 'Staging Access' "Policy name stored correctly"
assert_json_field "$POLICY" '.description' 'Limited access for staging servers' "Policy description stored"

# Verify IP lists
ALLOWED_COUNT=$(echo "$POLICY" | jq '.allowedIps | length')
assert_eq "$ALLOWED_COUNT" "2" "Allowed IPs count matches"

DENIED_COUNT=$(echo "$POLICY" | jq '.deniedIps | length')
assert_eq "$DENIED_COUNT" "1" "Denied IPs count matches"

# Verify numeric fields
assert_json_field "$POLICY" '.inactivityTimeout' '300' "Inactivity timeout stored"
assert_json_field "$POLICY" '.maxFileSize' '52428800' "Max file size stored"

# Verify blocklist
HARD_COUNT=$(echo "$POLICY" | jq '.commandBlocklist.hardBlocked | length')
assert_eq "$HARD_COUNT" "2" "Custom hard-blocked count"

DOCKER_RESTRICTED=$(echo "$POLICY" | jq -r '.commandBlocklist.restricted.docker')
assert_eq "$DOCKER_RESTRICTED" "false" "Docker restriction stored"

# ---------------------------------------------------------------------------
log_section "Create policy with explicit ID"
# ---------------------------------------------------------------------------

CREATE_EXPLICIT=$(api_post "shell/policies" '{
  "id": "my-custom-id",
  "name": "Custom ID Policy"
}')
assert_json_field "$CREATE_EXPLICIT" '.ok' 'true' "Policy with explicit ID created"
EXPLICIT_ID=$(echo "$CREATE_EXPLICIT" | jq -r '.policy.id')
assert_eq "$EXPLICIT_ID" "my-custom-id" "Explicit ID preserved"

# ---------------------------------------------------------------------------
log_section "Create policy — duplicate ID rejected"
# ---------------------------------------------------------------------------

DUP_STATUS=$(api_post_status "shell/policies" '{"id":"staging-access","name":"Duplicate"}')
assert_eq "$DUP_STATUS" "409" "Duplicate policy ID returns 409"

# ---------------------------------------------------------------------------
log_section "Create policy — validation errors"
# ---------------------------------------------------------------------------

# Missing name
NO_NAME_STATUS=$(api_post_status "shell/policies" '{"description":"no name"}')
assert_eq "$NO_NAME_STATUS" "400" "Policy without name returns 400"

# Invalid IP in allowedIps
BAD_IP_STATUS=$(api_post_status "shell/policies" '{"name":"Bad IP","allowedIps":["not-an-ip"]}')
assert_eq "$BAD_IP_STATUS" "400" "Invalid IP format returns 400"

# Invalid CIDR prefix
BAD_CIDR_STATUS=$(api_post_status "shell/policies" '{"name":"Bad CIDR","allowedIps":["10.0.0.0/33"]}')
assert_eq "$BAD_CIDR_STATUS" "400" "Invalid CIDR prefix returns 400"

# Inactivity timeout too low
BAD_TIMEOUT_STATUS=$(api_post_status "shell/policies" '{"name":"Bad Timeout","inactivityTimeout":10}')
assert_eq "$BAD_TIMEOUT_STATUS" "400" "Inactivity timeout below minimum returns 400"

# ---------------------------------------------------------------------------
log_section "Update policy"
# ---------------------------------------------------------------------------

UPDATE_RESP=$(api_patch "shell/policies/staging-access" '{
  "description": "Updated description",
  "allowedIps": ["10.0.0.0/8"],
  "deniedIps": [],
  "inactivityTimeout": 900
}')
assert_json_field "$UPDATE_RESP" '.ok' 'true' "Policy update succeeds"

UPDATED=$(echo "$UPDATE_RESP" | jq '.policy')
assert_json_field "$UPDATED" '.description' 'Updated description' "Description updated"
assert_json_field "$UPDATED" '.inactivityTimeout' '900' "Timeout updated"

UPDATED_ALLOWED=$(echo "$UPDATED" | jq '.allowedIps | length')
assert_eq "$UPDATED_ALLOWED" "1" "Allowed IPs updated"

UPDATED_DENIED=$(echo "$UPDATED" | jq '.deniedIps | length')
assert_eq "$UPDATED_DENIED" "0" "Denied IPs cleared"

# ---------------------------------------------------------------------------
log_section "Update policy — restricted commands merge"
# ---------------------------------------------------------------------------

# Add new restricted commands — should merge, not replace
MERGE_RESP=$(api_patch "shell/policies/staging-access" '{
  "commandBlocklist": {
    "restricted": {"npm": false, "yarn": true}
  }
}')
MERGED=$(echo "$MERGE_RESP" | jq '.policy.commandBlocklist.restricted')

# Original restriction should still exist
MERGED_DOCKER=$(echo "$MERGED" | jq -r '.docker')
assert_eq "$MERGED_DOCKER" "false" "Original docker restriction preserved after merge"

# New restriction should be added
MERGED_NPM=$(echo "$MERGED" | jq -r '.npm')
assert_eq "$MERGED_NPM" "false" "New npm restriction added"

MERGED_YARN=$(echo "$MERGED" | jq -r '.yarn')
assert_eq "$MERGED_YARN" "true" "New yarn allowed setting added"

# ---------------------------------------------------------------------------
log_section "Update non-existent policy → 404"
# ---------------------------------------------------------------------------

UPDATE_404=$(api_patch_status "shell/policies/does-not-exist" '{"description":"nope"}')
assert_eq "$UPDATE_404" "404" "Update non-existent policy returns 404"

# ---------------------------------------------------------------------------
log_section "Delete policy"
# ---------------------------------------------------------------------------

DELETE_RESP=$(api_delete "shell/policies/my-custom-id")
assert_json_field "$DELETE_RESP" '.ok' 'true' "Policy deletion succeeds"

# Verify it's gone
AFTER_DELETE=$(api_get "shell/policies")
REMAINING=$(echo "$AFTER_DELETE" | jq '[.policies[] | select(.id == "my-custom-id")] | length')
assert_eq "$REMAINING" "0" "Deleted policy no longer listed"

# ---------------------------------------------------------------------------
log_section "Delete default policy → 400"
# ---------------------------------------------------------------------------

DELETE_DEFAULT_STATUS=$(api_delete_status "shell/policies/default")
assert_eq "$DELETE_DEFAULT_STATUS" "400" "Cannot delete default policy"

# ---------------------------------------------------------------------------
log_section "Delete policy in use by agent → 400"
# ---------------------------------------------------------------------------

# Enable global shell and assign staging-access policy to agent
api_patch "shell/config" '{"enabled":true}' > /dev/null
api_post "shell/enable/test-agent" '{"durationMinutes":30,"policyId":"staging-access"}' > /dev/null

DELETE_IN_USE_STATUS=$(api_delete_status "shell/policies/staging-access")
assert_eq "$DELETE_IN_USE_STATUS" "400" "Cannot delete policy assigned to active agent"

# ---------------------------------------------------------------------------
log_section "Delete non-existent policy → 404"
# ---------------------------------------------------------------------------

DELETE_404=$(api_delete_status "shell/policies/nonexistent-policy")
assert_eq "$DELETE_404" "404" "Delete non-existent policy returns 404"

# ---------------------------------------------------------------------------
log_section "Set default policy"
# ---------------------------------------------------------------------------

# Change default to staging-access
PATCH_DEFAULT=$(api_patch "shell/config" '{"defaultPolicy":"staging-access"}')
assert_json_field "$PATCH_DEFAULT" '.ok' 'true' "Default policy change succeeds"

CONFIG=$(api_get "shell/config")
assert_json_field "$CONFIG" '.defaultPolicy' 'staging-access' "Default policy updated"

# Set invalid default → 400
BAD_DEFAULT_STATUS=$(api_patch_status "shell/config" '{"defaultPolicy":"nonexistent"}')
assert_eq "$BAD_DEFAULT_STATUS" "400" "Setting non-existent default policy returns 400"

# Restore default
api_patch "shell/config" '{"defaultPolicy":"default"}' > /dev/null

# ---------------------------------------------------------------------------
log_section "Cleanup"
# ---------------------------------------------------------------------------

api_delete "shell/enable/test-agent" > /dev/null
api_delete "shell/policies/staging-access" > /dev/null
api_patch "shell/config" '{"enabled":false}' > /dev/null
log_pass "Cleaned up policies and disabled shell"

end_test
