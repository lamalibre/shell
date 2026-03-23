#!/usr/bin/env bash
# ============================================================================
# Shell E2E Test Runner
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

echo ""
echo -e "${BOLD}Shell E2E Test Suite${RESET}"
echo -e "${DIM}$(printf '═%.0s' {1..60})${RESET}"
echo ""
echo -e "  Base URL:  ${CYAN}${BASE_URL}${RESET}"
echo ""

TOTAL_PASS=0; TOTAL_FAIL=0; TOTAL_SKIP=0

for test_script in "${SCRIPT_DIR}"/[0-9]*.sh; do
  [ -f "$test_script" ] || continue
  if bash "$test_script"; then
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi
done

echo ""
echo -e "${BOLD}Summary${RESET}"
echo -e "${DIM}$(printf '═%.0s' {1..60})${RESET}"
echo -e "  ${GREEN}Passed: ${TOTAL_PASS}${RESET}  ${RED}Failed: ${TOTAL_FAIL}${RESET}"
echo ""

if [ "$TOTAL_FAIL" -gt 0 ]; then exit 1; fi
