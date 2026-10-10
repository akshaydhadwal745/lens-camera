#!/usr/bin/env bash
# Makes build N the public Lens download (website button + in-app "New Lens
# version" prompt), after checking it:
#   - scripts/verify-release.sh N passes (release, OTA, update API, APK runtime)
#   - every APK on the download host is signed with Lens's release certificate
#   - its SHA-256 matches release.json
# Then copies downloads/android/builds/N/release.json to downloads/android/latest.json.
#
# Usage: scripts/promote-release.sh 41
# Runs in CI: .github/workflows/promote.yml (Actions → "Promote release" → Run),
# with the website deploy role. Locally it needs an AWS profile that can write
# the website bucket (PROMOTE_AWS_PROFILE, default "lens"; "" = environment credentials).
set -euo pipefail

N=${1:?usage: promote-release.sh <build number>}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROFILE=${PROMOTE_AWS_PROFILE-lens}
OUTPUTS="$ROOT/infra/outputs.json"
output() { python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(list(d.values())[0][sys.argv[2]])' "$OUTPUTS" "$1"; }
BUCKET=${WEB_BUCKET:-$(output WebBucket)}
DIST=${DISTRIBUTION_ID:-$(output DistributionId)}
aws_() { aws ${PROFILE:+--profile "$PROFILE"} "$@"; }
# Lens release key (infra/keys/android/lens-release.jks), lowercase hex, no colons.
RELEASE_CERT=bdd57ba599935d960364566e1bcbe99b920f52563172c1495dd801b39d28093b
APKSIGNER=${APKSIGNER:-$(ls "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/*/apksigner | sort -V | tail -1)}
# apksigner needs Java; use the local JDK if none is on PATH.
command -v java >/dev/null || export PATH="$(dirname "$(ls -d ~/.local/jdk/*/bin/java | head -1)"):$PATH"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "== verify-release $N"
"$ROOT/scripts/verify-release.sh" "$N" | tail -5

echo "== download host"
aws_ s3 cp "s3://$BUCKET/downloads/android/builds/$N/release.json" "$WORK/release.json" --only-show-errors
python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1])),indent=1))' "$WORK/release.json"
for abi in $(python3 -c 'import json,sys;print(" ".join(json.load(open(sys.argv[1]))["files"]))' "$WORK/release.json"); do
  read -r URL SHA < <(python3 -c 'import json,sys;f=json.load(open(sys.argv[1]))["files"][sys.argv[2]];print(f["url"],f["sha256"])' "$WORK/release.json" "$abi")
  curl -sfL -o "$WORK/$abi.apk" "$URL" || { echo "✗ $abi: download failed ($URL)"; exit 1; }
  GOT_SHA=$(sha256sum "$WORK/$abi.apk" | cut -d' ' -f1)
  [ "$GOT_SHA" = "$SHA" ] || { echo "✗ $abi: SHA-256 mismatch"; exit 1; }
  CERT=$("$APKSIGNER" verify --print-certs "$WORK/$abi.apk" | grep -m1 'SHA-256 digest' | awk '{print $NF}')
  [ "$CERT" = "$RELEASE_CERT" ] || { echo "✗ $abi: not signed with the Lens release key ($CERT)"; exit 1; }
  echo "✓ $abi: $URL, SHA-256 OK, release-signed"
done

echo "== promote"
aws_ s3 cp "$WORK/release.json" "s3://$BUCKET/downloads/android/latest.json" --only-show-errors \
  --content-type application/json --cache-control "public, max-age=60"
aws_ cloudfront create-invalidation --distribution-id "$DIST" --paths "/downloads/android/latest.json" \
  --query Invalidation.Id --output text >/dev/null
echo "✓ dev-$N is now the public download (website + in-app prompt)"
