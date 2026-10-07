#!/usr/bin/env bash
# Starts Metro behind a free Cloudflare quick tunnel so Expo Go can load the
# app from anywhere (mobile data, other Wi-Fi). Alternative to `expo start
# --tunnel`, whose ngrok service is often down.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8081}"
CLOUDFLARED="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
LOG=$(mktemp)

"$CLOUDFLARED" tunnel --no-autoupdate --url "http://localhost:${PORT}" >"$LOG" 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null; rm -f "$LOG"' EXIT

echo "Starting Cloudflare tunnel…"
URL=""
for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [[ -n "$URL" ]] && break
  sleep 1
done
if [[ -z "$URL" ]]; then
  echo "Could not start the tunnel:"; cat "$LOG"; exit 1
fi
echo "Tunnel: $URL"

EXPO_PACKAGER_PROXY_URL="$URL" npx expo start --port "$PORT" "$@"
