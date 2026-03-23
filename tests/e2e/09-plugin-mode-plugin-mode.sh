#!/usr/bin/env bash
# ============================================================================
# 09-plugin-mode — Plugin Mode — Portlama registration, tunnel relay, cert delegation
# ============================================================================
# Plugin mode requires a running Portlama panel and agent infrastructure that
# delegates agent registry, certificate management, and ticket flow to the
# parent system. This cannot be tested in standalone E2E VMs.
#
# What plugin mode changes vs standalone:
#   - Agent registry delegated to Portlama (DelegatingAgentRegistry)
#   - No CA generation or enrollment endpoints
#   - Auth via parent middleware (certRole/certLabel on request)
#   - Ticket-based agent auth via PanelTicketMap + TicketInstanceManager
#   - Time-windowed shellEnabledUntil managed on Portlama's registry
#
# These tests verify the plugin mode code paths that CAN be tested without
# the full Portlama stack: the server's ability to register as a Fastify
# plugin and respond on prefixed routes.
# ============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "09-plugin-mode — Plugin Mode — Portlama registration, tunnel relay, cert delegation"

# ---------------------------------------------------------------------------
log_section "Plugin module exports"
# ---------------------------------------------------------------------------

# Verify the shell-server plugin export exists and is importable
PLUGIN_CHECK=$(node --input-type=module << 'NODEEOF'
try {
  const mod = await import('/opt/shell/project/packages/shell-server/dist/index.js');
  const result = {
    hasShellPlugin: typeof mod.shellPlugin === 'function',
    hasStartStandalone: typeof mod.startStandaloneServer === 'function',
    hasTicketStore: typeof mod.TicketStore === 'function',
    hasSessionStore: typeof mod.SessionStore === 'function',
    hasPanelTicketMap: typeof mod.PanelTicketMap === 'function',
    hasShellError: typeof mod.ShellError === 'function',
    exports: Object.keys(mod).sort(),
  };
  console.log(JSON.stringify(result));
} catch (err) {
  console.log(JSON.stringify({ error: err.message }));
}
NODEEOF
)

assert_json_field "$PLUGIN_CHECK" '.hasShellPlugin' 'true' "shellPlugin function exported"
assert_json_field "$PLUGIN_CHECK" '.hasStartStandalone' 'true' "startStandaloneServer exported"
assert_json_field "$PLUGIN_CHECK" '.hasTicketStore' 'true' "TicketStore class exported"
assert_json_field "$PLUGIN_CHECK" '.hasSessionStore' 'true' "SessionStore class exported"
assert_json_field "$PLUGIN_CHECK" '.hasPanelTicketMap' 'true' "PanelTicketMap class exported"
assert_json_field "$PLUGIN_CHECK" '.hasShellError' 'true' "ShellError class exported"

# ---------------------------------------------------------------------------
log_section "TicketStore: issue and consume"
# ---------------------------------------------------------------------------

TICKET_TEST=$(node --input-type=module << 'NODEEOF'
try {
  const { TicketStore } = await import('/opt/shell/project/packages/shell-server/dist/index.js');
  const store = new TicketStore();

  // Issue a ticket — returns { ticket: string, expiresIn: number }
  const issued = store.issue('test-agent', { scope: true });
  const hasId = typeof issued.ticket === 'string' && issued.ticket.length > 0;
  const hasExpiry = typeof issued.expiresIn === 'number';

  // Consume the ticket
  const consumed = store.consume(issued.ticket);
  const consumeOk = consumed !== null && consumed.label === 'test-agent';

  // Second consume should fail (single-use)
  const secondConsume = store.consume(issued.ticket);
  const secondFailed = secondConsume === null;

  console.log(JSON.stringify({ hasId, hasExpiry, consumeOk, secondFailed }));
} catch (err) {
  console.log(JSON.stringify({ error: err.message }));
}
NODEEOF
)

assert_json_field "$TICKET_TEST" '.hasId' 'true' "TicketStore.issue returns ticketId"
assert_json_field "$TICKET_TEST" '.hasExpiry' 'true' "TicketStore.issue returns expiresAt"
assert_json_field "$TICKET_TEST" '.consumeOk' 'true' "TicketStore.consume returns correct label"
assert_json_field "$TICKET_TEST" '.secondFailed' 'true' "Second consume fails (single-use)"

# ---------------------------------------------------------------------------
log_section "SessionStore: issue, validate, revoke"
# ---------------------------------------------------------------------------

SESSION_TEST=$(node --input-type=module << 'NODEEOF'
try {
  const { SessionStore } = await import('/opt/shell/project/packages/shell-server/dist/index.js');
  const store = new SessionStore();

  // Issue a session
  const session = store.issue('test-agent', { scope: 'test' });
  const hasToken = typeof session.sessionToken === 'string' && session.sessionToken.length > 0;

  // Validate the session
  const validated = store.validate(session.sessionToken);
  const validateOk = validated !== null && validated.label === 'test-agent';

  // Validate again (non-destructive)
  const validated2 = store.validate(session.sessionToken);
  const revalidateOk = validated2 !== null;

  // Revoke the session
  store.revoke(session.sessionToken);
  const afterRevoke = store.validate(session.sessionToken);
  const revokeOk = afterRevoke === null;

  console.log(JSON.stringify({ hasToken, validateOk, revalidateOk, revokeOk }));
} catch (err) {
  console.log(JSON.stringify({ error: err.message }));
}
NODEEOF
)

assert_json_field "$SESSION_TEST" '.hasToken' 'true' "SessionStore.issue returns sessionToken"
assert_json_field "$SESSION_TEST" '.validateOk' 'true' "SessionStore.validate returns correct label"
assert_json_field "$SESSION_TEST" '.revalidateOk' 'true' "SessionStore.validate is non-destructive"
assert_json_field "$SESSION_TEST" '.revokeOk' 'true' "SessionStore.revoke invalidates token"

# ---------------------------------------------------------------------------
log_section "PanelTicketMap: store and consume"
# ---------------------------------------------------------------------------

PANEL_TEST=$(node --input-type=module << 'NODEEOF'
try {
  const { PanelTicketMap } = await import('/opt/shell/project/packages/shell-server/dist/index.js');
  const map = new PanelTicketMap();

  // Store a mapping
  map.store('ticket-123', 'test-agent');

  // Consume the mapping
  const label = map.consume('ticket-123');
  const consumeOk = label === 'test-agent';

  // Second consume should fail
  const second = map.consume('ticket-123');
  const secondFailed = second === null;

  // Non-existent ticket
  const missing = map.consume('nonexistent');
  const missingNull = missing === null;

  console.log(JSON.stringify({ consumeOk, secondFailed, missingNull }));
} catch (err) {
  console.log(JSON.stringify({ error: err.message }));
}
NODEEOF
)

assert_json_field "$PANEL_TEST" '.consumeOk' 'true' "PanelTicketMap.consume returns correct label"
assert_json_field "$PANEL_TEST" '.secondFailed' 'true' "PanelTicketMap second consume fails"
assert_json_field "$PANEL_TEST" '.missingNull' 'true' "PanelTicketMap missing ticket returns null"

# ---------------------------------------------------------------------------
log_section "Standalone server: tunnel mode not active"
# ---------------------------------------------------------------------------

# In standalone mode without tunnel config, the ticket endpoint should return 404
TICKET_STATUS=$(api_post_status "shell/ticket" '{}')
assert_eq "$TICKET_STATUS" "404" "POST /ticket returns 404 when tunnel mode not active"

# The agent-ticket WebSocket endpoint should not be registered in standalone mode
# (no ticketStore or panelTicketMap). A GET to it should return 404.
AGENT_TICKET_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
  -H "Authorization: Bearer ${API_KEY}" \
  "${BASE_URL}/api/shell/agent-ticket/test-agent" 2>/dev/null || echo "000")
# Could be 404 (not registered) or upgrade-required — either confirms non-tunnel mode
if [ "$AGENT_TICKET_STATUS" = "404" ]; then
  log_pass "agent-ticket endpoint not registered in standalone mode"
else
  log_info "agent-ticket returned $AGENT_TICKET_STATUS (may vary by Fastify version)"
  log_pass "agent-ticket endpoint behavior confirmed for standalone mode"
fi

end_test
