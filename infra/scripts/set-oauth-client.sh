#!/usr/bin/env bash
# Stores a storage provider's OAuth app credentials for the Lens API (SSM, encrypted).
# Usage: scripts/set-oauth-client.sh <gdrive|dropbox|onedrive|box> <client-id> <client-secret>
# The redirect URI to register with the provider is printed at the end.
set -euo pipefail
P=${1:?provider}; ID=${2:?client id}; SECRET=${3:?client secret}
case "$P" in gdrive|dropbox|onedrive|box) ;; *) echo "unknown provider $P"; exit 1;; esac
aws ssm put-parameter --profile lens --name "/lens/oauth/$P/client-id" --type SecureString --value "$ID" --overwrite >/dev/null
aws ssm put-parameter --profile lens --name "/lens/oauth/$P/client-secret" --type SecureString --value "$SECRET" --overwrite >/dev/null
API=$(node -p "require('$(cd "$(dirname "$0")/.." && pwd)/outputs.json').Lens.ApiUrl.replace(/\/$/, '')")
echo "Saved $P credentials. Redirect URI to register: $API/v1/oauth/callback"
