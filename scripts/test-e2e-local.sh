#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "docker is required"; exit 1; }
command -v bun >/dev/null || { echo "bun is required"; exit 1; }

NAME="contentkit-e2e-$$"
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm -d --name "$NAME" \
  -e POSTGRES_PASSWORD=contentkit-e2e \
  -e POSTGRES_DB=contentkit \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null

PORT=$(docker port "$NAME" 5432/tcp | sed -nE 's/.*:([0-9]+)$/\1/p')
[ -n "$PORT" ] || { echo "failed to resolve PostgreSQL port"; exit 1; }

npm run build:binary

CONTENTKIT_E2E_BINARY="$PWD/dist/contentkit" \
CONTENTKIT_E2E_DATABASE_URL="postgresql://postgres:contentkit-e2e@127.0.0.1:${PORT}/contentkit" \
  node --test test/e2e/local-binary.test.mjs
