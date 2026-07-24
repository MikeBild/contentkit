#!/bin/bash
# Boot a sandboxed ContentKit for the elicitation matrix: dedicated port 4571,
# dedicated scratch database (contentkit_elicit) in the shared local Postgres
# container, dedicated boundary on 55434, run-specific bootstrap admin key.
# Ground truth for verdicts is the engine log (JSON lines) plus the audit REST
# surface — never the client's narrated text.
# Exposes: engine_start, engine_stop, engine_admin_key, engine_create_site,
#          engine_create_draft, engine_log_mark, engine_log_since,
#          engine_max_mcp_post_ms, engine_audit_count, ENGINE_LOG, ENGINE_URL.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SHOTS_DIR="${SHOTS_DIR:-$REPO_ROOT/tests/real-world/elicitation/shots}"
ENGINE_LOG="$SHOTS_DIR/engine.log"
ENGINE_PID_FILE="$SHOTS_DIR/engine.pid"
ENGINE_KEY_FILE="$SHOTS_DIR/engine.key"
ENGINE_PORT=4571
ENGINE_URL="http://127.0.0.1:$ENGINE_PORT"
BOUNDARY_PORT=55434
CONTAINER=contentkit-local-postgres
SCRATCH_DB=contentkit_elicit
SCRATCH_DB_URL="postgresql://postgres:contentkit-local@127.0.0.1:55432/$SCRATCH_DB"

engine_start() {
  mkdir -p "$SHOTS_DIR"
  if curl -sf "$ENGINE_URL/ready" >/dev/null 2>&1; then
    echo "FATAL: port $ENGINE_PORT already serves an engine — stop it first (the matrix must own the log)" >&2
    return 1
  fi
  docker info >/dev/null 2>&1 || { echo "FATAL: Docker is required (local Postgres container)" >&2; return 1; }
  docker inspect "$CONTAINER" >/dev/null 2>&1 || docker run -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=contentkit-local -e POSTGRES_DB=contentkit \
    -p 127.0.0.1:55432:5432 -v contentkit-local-postgres:/var/lib/postgresql/data \
    postgres:16-alpine >/dev/null
  docker start "$CONTAINER" >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$CONTAINER" psql -U postgres -q \
    -c "DROP DATABASE IF EXISTS $SCRATCH_DB" -c "CREATE DATABASE $SCRATCH_DB" >/dev/null

  local key="ck-elicit-$(openssl rand -hex 12)"
  printf '%s' "$key" > "$ENGINE_KEY_FILE"
  rm -rf "$SHOTS_DIR/.boundary"
  (
    cd "$REPO_ROOT"
    PORT=$ENGINE_PORT \
    CONTENTKIT_PUBLIC_URL="$ENGINE_URL" \
    DATABASE_URL="$SCRATCH_DB_URL" \
    CONTENTKIT_BOOTSTRAP_API_KEY="$key" \
    CONTENTKIT_MCP_ELICITATION_TIMEOUT_MS=120000 \
    ELICIT_BOUNDARY_PORT=$BOUNDARY_PORT \
    ELICIT_BOUNDARY_DATA_DIR="$SHOTS_DIR/.boundary" \
    SUPABASE_URL="http://127.0.0.1:$BOUNDARY_PORT" \
    CONTENTKIT_WEBHOOK_URL="http://127.0.0.1:$BOUNDARY_PORT/hooks/contentkit-notifications" \
      nohup node tests/real-world/elicitation/lib/boot-engine.mjs > "$ENGINE_LOG" 2>&1 &
    echo $! > "$ENGINE_PID_FILE"
  )
  for _ in $(seq 1 60); do
    curl -sf "$ENGINE_URL/ready" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "FATAL: engine did not become ready; tail of log:" >&2
  tail -20 "$ENGINE_LOG" >&2
  return 1
}

engine_admin_key() { cat "$ENGINE_KEY_FILE"; }

engine_stop() {
  [ -f "$ENGINE_PID_FILE" ] && kill "$(cat "$ENGINE_PID_FILE")" 2>/dev/null || true
  rm -f "$ENGINE_PID_FILE"
}

# Create the scratch site once per run; prints the site id.
engine_create_site() {
  curl -sf -X POST "$ENGINE_URL/v1/sites" \
    -H "Authorization: Bearer $(engine_admin_key)" -H 'content-type: application/json' \
    -d '{"name":"Elicitation Matrix","base_url":"http://elicit.local","default_locale":"en"}' | jq -r .id
}

# Create a fresh draft in the scratch site; prints the content item id.
engine_create_draft() { # site_id
  local site_id="$1" slug="elicit-probe-$(openssl rand -hex 4)"
  printf -- '---\nkind: page\ntitle: Elicitation probe %s\nlocale: en\nslug: %s\n---\n\n# Probe\n\nDraft used by the elicitation matrix.\n' "$slug" "$slug" \
    | curl -sf -X POST "$ENGINE_URL/v1/sites/$site_id/content" \
        -H "Authorization: Bearer $(engine_admin_key)" -H 'content-type: text/markdown' \
        --data-binary @- | jq -r .item.id
}

# Line-count marker + grep of log lines written after the marker whose JSON
# "msg" or "error" field matches the pattern (grep -E).
engine_log_mark() { wc -l < "$ENGINE_LOG" | tr -d ' '; }
engine_log_since() {
  local mark="$1" pattern="$2"
  tail -n +"$((mark + 1))" "$ENGINE_LOG" | grep -E "\"(msg|error)\":\"[^\"]*(${pattern})" || true
}

# Highest "ms" among POST /mcp request lines after the marker — the guarded
# tools/call is always the longest MCP POST of a cell, so this is the
# elicitation round-trip duration (fast-cancel discriminator: < 2000).
engine_max_mcp_post_ms() {
  local mark="$1"
  # || true: with pipefail a grep miss (no matching line yet) must yield an
  # empty result, not kill the calling cell script.
  tail -n +"$((mark + 1))" "$ENGINE_LOG" \
    | grep '"msg":"request"' | grep '"path":"/mcp"' | grep '"method":"POST"' \
    | sed -n 's/.*"ms":\([0-9]*\).*/\1/p' | sort -n | tail -1 || true
}

# Count audit events for an action (optionally a specific resource id).
engine_audit_count() { # action [resource_id]
  local action="$1" resource="${2:-}"
  curl -sf "$ENGINE_URL/v1/audit-events?action=$action&limit=200" \
    -H "Authorization: Bearer $(engine_admin_key)" \
    | jq -r --arg r "$resource" '[.events[] | select($r == "" or .resource_id == $r)] | length'
}
