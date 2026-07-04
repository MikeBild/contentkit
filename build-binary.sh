#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cleanup() {
  rm -f .node-bin payload.tgz
}
trap cleanup EXIT

node scripts/gen-embedded-migrations.mjs
cp "$(command -v node)" .node-bin
rm -f payload.tgz
tar --use-compress-program 'gzip -1' -cf payload.tgz \
  .node-bin server.mjs src scripts assets docs package.json .env.defaults .env.example node_modules
KEY="$(shasum -a 256 payload.tgz | cut -c1-16)"
printf "export default '%s'\n" "$KEY" > bin/cache-key.ts
mkdir -p dist
bun build bin/contentkit.ts --compile --outfile dist/contentkit
echo "dist/contentkit ($(du -h dist/contentkit | cut -f1))"
