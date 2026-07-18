#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cleanup() {
  rm -f .node-bin payload.tgz
}
trap cleanup EXIT

node scripts/gen-embedded-migrations.mjs
NODE_BINARY="${CONTENTKIT_NODE_BINARY:-$(command -v node)}"
if [[ ! -x "$NODE_BINARY" ]]; then
  echo "CONTENTKIT_NODE_BINARY must point to an executable Node.js binary" >&2
  exit 1
fi
# Homebrew may build Node as a thin executable that needs libnode from the
# machine's Cellar. Copying only that executable would produce an artifact that
# compiles successfully and then crashes after extraction. Official Node.js
# binaries (including setup-node/nvm) are self-contained on macOS.
if [[ "$(uname -s)" == "Darwin" ]] && otool -L "$NODE_BINARY" | grep -q '@rpath/libnode'; then
  echo "Node.js at $NODE_BINARY depends on an external libnode dylib." >&2
  echo "Set CONTENTKIT_NODE_BINARY to a self-contained official Node.js binary." >&2
  exit 1
fi
cp "$NODE_BINARY" .node-bin
rm -f payload.tgz
tar --use-compress-program 'gzip -1' -cf payload.tgz \
  .node-bin server.mjs src scripts assets docs package.json .env.defaults .env.example node_modules
KEY="$(shasum -a 256 payload.tgz | cut -c1-16)"
printf "export default '%s'\n" "$KEY" > bin/cache-key.ts
mkdir -p dist
bun build bin/contentkit.ts --compile --outfile dist/contentkit
echo "dist/contentkit ($(du -h dist/contentkit | cut -f1))"
