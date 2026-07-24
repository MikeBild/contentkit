#!/bin/bash
# Claude Code cell: fresh `claude` in tmux against the sandboxed ContentKit
# /mcp (streamable HTTP, bearer key). Claude Code renders the elicitation form
# at END of its agent turn; a REUSED instance (after /clear) may auto-cancel
# the form in ~16ms — the fast-cancel scenario reproduces exactly that.
# Usage: claude-code.sh <scenario: accept|timeout|cancel|fast-cancel> <api_key>
# Requires: CK_SITE_ID exported by run-matrix.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../lib/engine.sh"
source "$HERE/../lib/tmux.sh"

SCENARIO="${1:?scenario}" ; KEY="${2:?api key}"
: "${CK_SITE_ID:?CK_SITE_ID must be exported}"
CELL="cc-$SCENARIO"
OUT="$SHOTS_DIR/claude-code-$SCENARIO"
WORKDIR="$(mktemp -d /tmp/ck-elicit-cc.XXXXXX)"

verdict() { echo "$1" | tee "$SHOTS_DIR/claude-code-$SCENARIO.verdict"; }
prompt_for() { # item_id
  echo "Use MCP server ck-elicit-matrix: call the tool contentkit_content with arguments {\"action\":\"delete_draft\",\"site\":\"$CK_SITE_ID\",\"item_id\":\"$1\"}. Do NOT answer any confirmation form yourself. When the tool returns, STOP and report the raw tool result."
}

# Wait until the elicitation form renders; auto-approve any tool-permission
# dialog on the way (permission prompts are not the elicitation under test).
wait_form() { # deadline_s
  local deadline="${1:-240}" waited=0 pane
  while [ "$waited" -lt "$deadline" ]; do
    pane="$(tmux capture-pane -p -t "$CELL")"
    if echo "$pane" | grep -qiE "requests your input"; then return 0; fi
    if echo "$pane" | grep -qiE "do you want to|allow this|permission"; then
      tmux send-keys -t "$CELL" Enter; sleep 3; waited=$((waited + 3)); continue
    fi
    sleep 2; waited=$((waited + 2))
  done
  return 1
}

cleanup() { tmux_kill "$CELL"; rm -rf "$WORKDIR"; }
trap cleanup EXIT
trap 'verdict "FAIL: script error at line $LINENO (cmd: $BASH_COMMAND)"' ERR

( cd "$WORKDIR" && claude mcp add --transport http --scope local ck-elicit-matrix \
    "$ENGINE_URL/mcp" --header "Authorization: Bearer $KEY" >/dev/null )

ITEM_ID="$(engine_create_draft "$CK_SITE_ID")"
[ -n "$ITEM_ID" ] && [ "$ITEM_ID" != "null" ] || { verdict "FAIL: could not create draft"; exit 1; }

MARK="$(engine_log_mark)"
tmux_fresh "$CELL" "$WORKDIR"
tmux send-keys -t "$CELL" 'claude' Enter
tmux_wait "$CELL" "trust this folder|shortcuts|❯" 45 || { verdict "FAIL: claude did not start"; exit 1; }
if tmux capture-pane -p -t "$CELL" | grep -q "trust this folder"; then
  tmux send-keys -t "$CELL" Enter; sleep 4
fi
tmux_submit "$CELL" "$(prompt_for "$ITEM_ID")"

if [ "$SCENARIO" != "fast-cancel" ]; then
  wait_form 240 || { tmux_snap "$CELL" "$OUT-no-form"; verdict "FAIL: form never rendered"; exit 1; }
  tmux_snap "$CELL" "$OUT-form"
fi

case "$SCENARIO" in
  accept)
    sleep 65   # deliberately beat the SDK's 60s default before answering
    tmux send-keys -t "$CELL" Space; sleep 1          # toggle confirmed=true
    tmux send-keys -t "$CELL" Down Down Down; sleep 1 # focus submit
    tmux send-keys -t "$CELL" Enter; sleep 2
    tmux send-keys -t "$CELL" Enter; sleep 5          # settle focus variants
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
  fast-cancel)
    # Round 1: render a form in this instance and cancel it like a human.
    wait_form 240 || { tmux_snap "$CELL" "$OUT-no-form"; verdict "FAIL: round-1 form never rendered"; exit 1; }
    tmux_snap "$CELL" "$OUT-round1-form"
    sleep 3
    tmux send-keys -t "$CELL" Escape; sleep 8
    # Round 2: REUSED instance after /clear — the documented auto-cancel quirk.
    tmux_submit "$CELL" "/clear"; sleep 4
    ITEM2="$(engine_create_draft "$CK_SITE_ID")"
    MARK2="$(engine_log_mark)"
    tmux_submit "$CELL" "$(prompt_for "$ITEM2")"
    # Wait until the guarded tools/call has completed (its POST /mcp line appears).
    waited=0
    while [ "$waited" -lt 240 ]; do
      MS="$(engine_max_mcp_post_ms "$MARK2")"
      if [ -n "$MS" ] && [ -n "$(engine_log_since "$MARK2" 'Operation cancelled|elicitation|content.delete_draft')" ]; then
        break
      fi
      if tmux capture-pane -p -t "$CELL" | grep -qiE "requests your input"; then
        tmux_snap "$CELL" "$OUT-round2-form"
      fi
      sleep 2; waited=$((waited + 2))
    done
    tmux_snap "$CELL" "$OUT-round2-final"
    MS="$(engine_max_mcp_post_ms "$MARK2")"
    AUDIT="$(engine_audit_count content.delete_draft "$ITEM2")"
    if [ "$AUDIT" != "0" ]; then
      verdict "FAIL: reused-session round mutated the draft without a rendered decision (ms=${MS:-none})"
      exit 1
    fi
    if [ -n "$MS" ] && [ "$MS" -lt 2000 ]; then
      verdict "OBSERVED: client auto-cancel reproduced — elicitation round-trip ${MS}ms (<2000ms), no mutation. $(engine_log_since "$MARK2" 'Operation cancelled|elicitation' | head -1)"
    else
      verdict "OBSERVED: no auto-cancel this round — elicitation round-trip ${MS:-none}ms, no mutation. $(engine_log_since "$MARK2" 'elicitation|Operation cancelled' | head -1)"
    fi
    ;;
  *) verdict "FAIL: unknown scenario $SCENARIO"; exit 1 ;;
esac
