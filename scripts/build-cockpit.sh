#!/usr/bin/env bash
# Builds ContentKit Cockpit into assets/cockpit so build-binary.sh's existing
# `assets` tar entry carries the console into the self-contained binary.
#
# apps/cockpit deliberately has its own node_modules and is NOT an npm
# workspace: build-binary.sh tars the root node_modules wholesale, so hoisting
# React, Vite and the AI SDK up there would put the console's entire build
# toolchain inside the shipped binary.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=apps/cockpit
OUT=assets/cockpit

if [[ ! -d "$APP" ]]; then
  echo "$APP is missing; cannot build the Cockpit" >&2
  exit 1
fi

# Vite and TypeScript are devDependencies, so --omit=dev would remove exactly
# what the build needs.
if [[ ! -d "$APP/node_modules" ]]; then
  echo "installing Cockpit dependencies"
  (cd "$APP" && npm ci --no-audit --no-fund)
fi

(cd "$APP" && npm run build)

# Fail loudly. Without this a broken or skipped build would produce a binary
# that starts fine and answers 503 on /cockpit — a defect nobody notices until
# an operator tries to sign in.
if [[ ! -f "$OUT/index.html" ]]; then
  echo "Cockpit build produced no $OUT/index.html" >&2
  exit 1
fi

echo "built $OUT ($(du -sh "$OUT" | cut -f1))"
