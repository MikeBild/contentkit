#!/bin/bash
# tmux helpers for driving a real client TUI: fresh session, prompt
# submission (paste-safe: text first, Enter separately), pane polling, and
# frame capture (.txt plain, .ansi.txt colored, .png via lib/ansi2png.py).
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tmux_fresh() { # session_name workdir [cols rows]
  local name="$1" dir="$2" cols="${3:-200}" rows="${4:-50}"
  tmux kill-session -t "$name" 2>/dev/null || true
  tmux new-session -d -s "$name" -c "$dir" -x "$cols" -y "$rows"
}

tmux_submit() { # session_name text  — paste-safe prompt submission
  tmux send-keys -t "$1" "$2"
  sleep 1
  tmux send-keys -t "$1" Enter
}

# Poll the pane until a pattern appears (grep -E -i). Prints the matching
# poll index; returns 1 on deadline. Usage: tmux_wait session pattern timeout_s
tmux_wait() {
  local name="$1" pattern="$2" deadline="${3:-120}" waited=0
  while [ "$waited" -lt "$deadline" ]; do
    if tmux capture-pane -p -t "$name" | grep -qiE "$pattern"; then return 0; fi
    sleep 2; waited=$((waited + 2))
  done
  return 1
}

tmux_snap() { # session_name outfile_base — writes .txt, .ansi.txt, .png
  local name="$1" base="$2"
  tmux capture-pane -p -t "$name" > "$base.txt"
  tmux capture-pane -e -p -t "$name" > "$base.ansi.txt"
  python3 "$LIB_DIR/ansi2png.py" "$base.ansi.txt" "$base.png" 2>/dev/null \
    || echo "(png render skipped — PIL unavailable)" >&2
}

tmux_kill() { tmux kill-session -t "$1" 2>/dev/null || true; }
