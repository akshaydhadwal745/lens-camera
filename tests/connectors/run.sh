#!/usr/bin/env bash
# Runs the real S3 and WebDAV connector code in Node (expo modules shimmed):
#   S3     → the Lens bucket under e2e-s3conn/ (uses the `lens` AWS profile)
#   WebDAV → a throwaway local server (pip install wsgidav cheroot)
# Usage: tests/connectors/run.sh [s3|webdav|all]
set -euo pipefail
cd "$(dirname "$0")"
WHICH=${1:-all}
node build.mjs test-conn
if [[ $WHICH == s3 || $WHICH == all ]]; then
  CREDS=$(mktemp); trap 'rm -f "$CREDS"' EXIT
  aws configure export-credentials --profile lens --format env-no-export > "$CREDS"
  CREDS=$CREDS node test-conn.mjs s3
fi
if [[ $WHICH == webdav || $WHICH == all ]]; then
  mkdir -p /tmp/lens-webdav-test
  wsgidav --config webdav.yaml >/tmp/lens-webdav-test.log 2>&1 & DAV=$!
  sleep 3
  node test-conn.mjs webdav || { kill $DAV; exit 1; }
  kill $DAV
fi
