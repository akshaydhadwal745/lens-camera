#!/usr/bin/env bash
# Runs the app's upload-while-recording code (src/lib/live-upload.ts) and the
# regular uploader's fallback against the deployed API, with a fake growing
# recording whose header is rewritten at the end. Expo modules are shimmed.
set -euo pipefail
cd "$(dirname "$0")"
node build.mjs
SHIM=$(mktemp -d); trap 'rm -rf "$SHIM"' EXIT
EXPO_PUBLIC_API_URL="$(node -p "require('../../infra/outputs.json').Lens.ApiUrl.replace(/\/$/, '')")" SHIM_ROOT="$SHIM" node test-live.mjs
