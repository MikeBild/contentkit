#!/bin/bash
# Real-world MCP elicitation matrix driver for ContentKit. See README.md.
# Usage: run-matrix.sh [client] [scenario]
#   client:   claude-code | codex | scripted   (default: all)
#   scenario: accept | timeout | cancel | fast-cancel | nocap  (default: per client)
# fast-cancel runs only on claude-code; nocap only on scripted.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SHOTS_DIR="$HERE/shots"
source "$HERE/lib/engine.sh"

CLIENTS="${1:-claude-code codex scripted}"
SCENARIOS="${2:-}"

mkdir -p "$SHOTS_DIR"
echo "== booting sandboxed ContentKit (port 4571, scratch db, 120s elicitation timeout) =="
engine_start
trap engine_stop EXIT
KEY="$(engine_admin_key)"
[ -n "$KEY" ] || { echo "FATAL: no admin key" >&2; exit 1; }
CK_SITE_ID="$(engine_create_site)"
export CK_SITE_ID
[ -n "$CK_SITE_ID" ] && [ "$CK_SITE_ID" != "null" ] || { echo "FATAL: could not create scratch site" >&2; exit 1; }
echo "-- scratch site: $CK_SITE_ID"

scenarios_for() {
  case "$1" in
    claude-code) echo "${SCENARIOS:-accept cancel timeout fast-cancel}" ;;
    codex)       echo "${SCENARIOS:-accept cancel timeout}" ;;
    scripted)    echo "${SCENARIOS:-nocap}" ;;
  esac
}

FAILED=0
for client in $CLIENTS; do
  if [ "$client" != "scripted" ]; then
    command -v "${client%%-*}" >/dev/null 2>&1 || command -v claude >/dev/null 2>&1 || {
      echo "-- $client: binary not found, skipping"; continue; }
  fi
  for scenario in $(scenarios_for "$client"); do
    echo "== cell: $client × $scenario =="
    if [ "$client" = "scripted" ]; then
      ITEM_ID="$(engine_create_draft "$CK_SITE_ID")"
      if node "$HERE/lib/nocap-client.mjs" "$ENGINE_URL" "$KEY" "$CK_SITE_ID" "$ITEM_ID" "$SHOTS_DIR"; then
        echo "-- $client × $scenario: PASS"
      else
        echo "-- $client × $scenario: FAIL"; FAILED=1
      fi
      continue
    fi
    if "$HERE/clients/$client.sh" "$scenario" "$KEY"; then
      echo "-- $client × $scenario: done"
    else
      echo "-- $client × $scenario: FAIL"; FAILED=1
    fi
  done
done

echo
echo "== verdicts =="
cat "$SHOTS_DIR"/*.verdict 2>/dev/null || true
exit "$FAILED"
