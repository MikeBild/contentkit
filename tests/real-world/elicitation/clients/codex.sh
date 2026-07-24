#!/bin/bash
# Codex cell: fresh `codex` in tmux against the sandboxed ContentKit /mcp via a
# TEMPORARY CODEX_HOME (generated config.toml + copied auth.json) — the user's
# ~/.codex/config.toml is never touched. Codex renders the elicitation form
# INLINE while the tool call is live and re-renders it on re-delivery; always
# act on the newest form. ContentKit's confirm form has ONE boolean field.
# Usage: codex.sh <scenario: accept|timeout|cancel> <api_key>
# Requires: CK_SITE_ID exported by run-matrix.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib/engine.sh"
source "$HERE/../lib/tmux.sh"

SCENARIO="${1:?scenario}" ; KEY="${2:?api key}"
: "${CK_SITE_ID:?CK_SITE_ID must be exported}"
CELL="codex-$SCENARIO"
OUT="$SHOTS_DIR/codex-$SCENARIO"
WORKDIR="$(mktemp -d /tmp/ck-elicit-codex.XXXXXX)"
CODEX_TMP_HOME="$(mktemp -d /tmp/ck-elicit-codex-home.XXXXXX)"

verdict() { echo "$1" | tee "$SHOTS_DIR/codex-$SCENARIO.verdict"; }

cleanup() { tmux_kill "$CELL"; rm -rf "$WORKDIR" "$CODEX_TMP_HOME"; }
trap cleanup EXIT
trap 'verdict "FAIL: script error at line $LINENO (cmd: $BASH_COMMAND)"' ERR

cat > "$CODEX_TMP_HOME/config.toml" <<EOF
[mcp_servers.ck-elicit-matrix]
url = "$ENGINE_URL/mcp"
bearer_token_env_var = "CK_ELICIT_MATRIX_KEY"
EOF
cp "$HOME/.codex/auth.json" "$CODEX_TMP_HOME/auth.json" 2>/dev/null \
  || { verdict "FAIL: ~/.codex/auth.json missing — log in to codex first"; exit 1; }

ITEM_ID="$(engine_create_draft "$CK_SITE_ID")"
[ -n "$ITEM_ID" ] && [ "$ITEM_ID" != "null" ] || { verdict "FAIL: could not create draft"; exit 1; }

PROMPT="Use MCP server ck-elicit-matrix: call the tool contentkit_content with arguments {\"action\":\"delete_draft\",\"site\":\"$CK_SITE_ID\",\"item_id\":\"$ITEM_ID\"}. Do NOT answer any confirmation form yourself. When the tool returns, STOP and report the raw tool result."

MARK="$(engine_log_mark)"
tmux_fresh "$CELL" "$WORKDIR"
tmux send-keys -t "$CELL" "export CODEX_HOME=$CODEX_TMP_HOME CK_ELICIT_MATRIX_KEY=$KEY && codex" Enter
tmux_wait "$CELL" "trust the contents|model:" 45 || { verdict "FAIL: codex did not start"; exit 1; }
if tmux capture-pane -p -t "$CELL" | grep -q "trust the contents"; then
  tmux send-keys -t "$CELL" Enter; sleep 5
fi
tmux_submit "$CELL" "$PROMPT"

# Codex shows the form inline during the live tool call (one boolean field).
tmux_wait "$CELL" "Field 1/1|Field 1/2" 240 \
  || { tmux_snap "$CELL" "$OUT-no-form"; verdict "FAIL: form never rendered"; exit 1; }
tmux_snap "$CELL" "$OUT-form"

case "$SCENARIO" in
  accept)
    sleep 65   # deliberately beat the SDK's 60s default before answering
    tmux send-keys -t "$CELL" Up; sleep 1      # move from default "2. False" to "1. True"
    tmux send-keys -t "$CELL" Enter; sleep 8   # submit
    tmux_snap "$CELL" "$OUT-answered"
    sleep 5
    if [ "$(engine_audit_count content.delete_draft "$ITEM_ID")" = "1" ]; then
      verdict "PASS: answer >65s accepted; audit content.delete_draft recorded (mcp ms=$(engine_max_mcp_post_ms "$MARK"))"
    else
      verdict "FAIL: no content.delete_draft audit event ($(engine_log_since "$MARK" 'mcp tool call failed|Operation cancelled|timed out' | head -1))"
      exit 1
    fi
    ;;
  cancel)
    sleep 5
    tmux send-keys -t "$CELL" Escape; sleep 8
    tmux_snap "$CELL" "$OUT-cancelled"
    MS="$(engine_max_mcp_post_ms "$MARK")"
    if [ -n "$(engine_log_since "$MARK" 'Operation cancelled')" ] \
       && [ "$(engine_audit_count content.delete_draft "$ITEM_ID")" = "0" ] \
       && [ "${MS:-0}" -gt 2000 ]; then
      verdict "PASS: >2s human cancel recorded, no mutation (mcp ms=$MS)"
    else
      verdict "FAIL: cancel not recorded as expected (ms=${MS:-none}, audit=$(engine_audit_count content.delete_draft "$ITEM_ID"))"
      exit 1
    fi
    ;;
  timeout)
    sleep 130  # elicitation timeout is 120s in the harness engine
    tmux_snap "$CELL" "$OUT-unanswered"
    if [ -n "$(engine_log_since "$MARK" 'timed out|Request timed out')" ] \
       && [ "$(engine_audit_count content.delete_draft "$ITEM_ID")" = "0" ]; then
      verdict "PASS: unanswered form timed out server-side after 120s, no mutation"
    else
      verdict "FAIL: no timeout recorded or draft was mutated ($(engine_log_since "$MARK" 'mcp tool call failed' | head -1))"
      exit 1
    fi
    ;;
  *) verdict "FAIL: unknown scenario $SCENARIO"; exit 1 ;;
esac
