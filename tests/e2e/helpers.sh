#!/usr/bin/env bash
# ============================================================================
# Shell E2E Test Helpers
# ============================================================================
# Shared assertion functions, logging, and API helpers for Shell E2E tests.
# Source this file at the top of every test script.
# ============================================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# --- Counters ---
_PASS_COUNT=0
_FAIL_COUNT=0
_SKIP_COUNT=0
_TEST_NAME=""

# --- Configuration ---
BASE_URL="${BASE_URL:-https://127.0.0.1:9494}"
API_KEY="${API_KEY:-}"
CURL_TIMEOUT="${CURL_TIMEOUT:-30}"

# --- Logging ---

log_pass() { _PASS_COUNT=$((_PASS_COUNT + 1)); echo -e "  ${GREEN}✓${RESET} $1"; }
log_fail() { _FAIL_COUNT=$((_FAIL_COUNT + 1)); echo -e "  ${RED}✗${RESET} $1"; }
log_skip() { _SKIP_COUNT=$((_SKIP_COUNT + 1)); echo -e "  ${YELLOW}⊘${RESET} $1"; }
log_info() { echo -e "  ${DIM}$1${RESET}"; }
log_section() { echo ""; echo -e "  ${BOLD}${CYAN}$1${RESET}"; echo -e "  ${DIM}$( printf '─%.0s' {1..50} )${RESET}"; }

begin_test() {
  _TEST_NAME="$1"
  _PASS_COUNT=0; _FAIL_COUNT=0; _SKIP_COUNT=0
  echo ""
  echo -e "${BOLD}$1${RESET}"
  echo -e "${DIM}$( printf '═%.0s' {1..60} )${RESET}"
}

end_test() {
  echo ""
  echo -e "${DIM}$( printf '─%.0s' {1..60} )${RESET}"
  echo -e "  ${GREEN}Passed: ${_PASS_COUNT}${RESET}  ${RED}Failed: ${_FAIL_COUNT}${RESET}  ${YELLOW}Skipped: ${_SKIP_COUNT}${RESET}"
  echo ""
  if [ "$_FAIL_COUNT" -gt 0 ]; then return 1; fi
  return 0
}

# --- Assertions ---

assert_eq() {
  local actual="$1" expected="$2" msg="${3:-assert_eq}"
  if [ "$actual" = "$expected" ]; then log_pass "$msg"
  else log_fail "$msg (expected '$expected', got '$actual')"; fi
}

assert_not_eq() {
  local actual="$1" unexpected="$2" msg="${3:-assert_not_eq}"
  if [ "$actual" != "$unexpected" ]; then log_pass "$msg"
  else log_fail "$msg (got unexpected '$actual')"; fi
}

assert_contains() {
  local haystack="$1" needle="$2" msg="${3:-assert_contains}"
  if echo "$haystack" | grep -qF "$needle"; then log_pass "$msg"
  else log_fail "$msg (does not contain '$needle')"; fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" msg="${3:-assert_not_contains}"
  if ! echo "$haystack" | grep -qF "$needle"; then log_pass "$msg"
  else log_fail "$msg (contains '$needle')"; fi
}

assert_http_status() {
  local url="$1" expected="$2" msg="${3:-assert_http_status}"
  local status
  status=$(curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$url" 2>/dev/null || echo "000")
  assert_eq "$status" "$expected" "$msg"
}

assert_json_field() {
  local json="$1" path="$2" expected="$3" msg="${4:-assert_json_field}"
  local actual
  actual=$(echo "$json" | jq -r "$path" 2>/dev/null || echo "PARSE_ERROR")
  assert_eq "$actual" "$expected" "$msg"
}

assert_json_field_not_empty() {
  local json="$1" path="$2" msg="${3:-assert_json_field_not_empty}"
  local actual
  actual=$(echo "$json" | jq -r "$path" 2>/dev/null || echo "")
  if [ -n "$actual" ] && [ "$actual" != "null" ] && [ "$actual" != "" ]; then log_pass "$msg"
  else log_fail "$msg (field is empty or null)"; fi
}

# --- API Helpers ---

api_get() {
  curl -skf --max-time "$CURL_TIMEOUT" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H 'Accept: application/json' \
    "${BASE_URL}/api/$1"
}

api_post() {
  curl -skf --max-time "$CURL_TIMEOUT" \
    -H "Authorization: Bearer ${API_KEY}" \
    -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -d "$2" "${BASE_URL}/api/$1"
}

api_patch() {
  curl -skf --max-time "$CURL_TIMEOUT" \
    -H "Authorization: Bearer ${API_KEY}" \
    -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -d "$2" "${BASE_URL}/api/$1"
}

api_delete() {
  curl -skf --max-time "$CURL_TIMEOUT" \
    -H "Authorization: Bearer ${API_KEY}" \
    -X DELETE -H 'Accept: application/json' \
    "${BASE_URL}/api/$1"
}

api_get_status() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H 'Accept: application/json' \
    "${BASE_URL}/api/$1" 2>/dev/null || echo "000"
}

api_post_status() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
    -H "Authorization: Bearer ${API_KEY}" \
    -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -d "${2:-"{}"}" "${BASE_URL}/api/$1" 2>/dev/null || echo "000"
}

api_patch_status() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
    -H "Authorization: Bearer ${API_KEY}" \
    -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -d "$2" "${BASE_URL}/api/$1" 2>/dev/null || echo "000"
}

api_delete_status() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
    -H "Authorization: Bearer ${API_KEY}" \
    -X DELETE -H 'Accept: application/json' \
    "${BASE_URL}/api/$1" 2>/dev/null || echo "000"
}

# --- Utilities ---

require_commands() {
  for cmd in "$@"; do
    if ! command -v "$cmd" &>/dev/null; then
      echo -e "${RED}Required command not found: $cmd${RESET}" >&2
      exit 1
    fi
  done
}
