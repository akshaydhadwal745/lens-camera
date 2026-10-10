#!/usr/bin/env bash
# Verifies a dev-N release before its APK link is given to anyone:
#   1. the release has Lens.apk and says which commit it was built from
#   2. the OTA job published an update for the same runtime
#   3. the live update API serves it: signature valid against certs/certificate.pem,
#      bundle SHA-256 matches
#   4. the APK embeds that runtime, updates enabled, our update URL and certificate
#
# Usage: scripts/verify-release.sh 34
# Needs: gh (logged in), node, openssl, python3, Android build-tools (aapt2).
set -euo pipefail

N=${1:?usage: verify-release.sh <build number>}
REPO=akshaydhadwal745/lens-camera
ROOT=$(cd "$(dirname "$0")/.." && pwd)
AAPT2=${AAPT2:-$(ls -d "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/*/ | sort -V | tail -1)aapt2}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
T=$(gh auth token)
H="Authorization: Bearer $T"
fail() { echo "✗ $*"; exit 1; }

# 1. Release
curl -sf -H "$H" "https://api.github.com/repos/$REPO/releases/tags/dev-$N" > "$WORK/release.json" || fail "release dev-$N not found"
python3 - "$WORK/release.json" <<'EOF' || exit 1
import json, sys
d = json.load(open(sys.argv[1]))
names = [a["name"] for a in d.get("assets", [])]
first = (d.get("body") or "").splitlines()[0] if d.get("body") else ""
if "Lens.apk" not in names: print("✗ 1. Lens.apk missing:", names); sys.exit(1)
print("✓ 1. release:", ", ".join(names), "|", first)
EOF

# 2. OTA job of the same run
RUN=$(curl -s -H "$H" "https://api.github.com/repos/$REPO/actions/runs?per_page=50" | python3 -c "
import json, sys
runs = [r for r in json.load(sys.stdin)['workflow_runs'] if r['name'] == 'App builds' and r['run_number'] == $N]
print(runs[0]['id'] if runs else '')")
[ -n "$RUN" ] || fail "2. run #$N not found"
OTA_JOB=$(curl -s -H "$H" "https://api.github.com/repos/$REPO/actions/runs/$RUN/jobs" | python3 -c "
import json, sys
print(next((j['id'] for j in json.load(sys.stdin)['jobs'] if j['name'] == 'ota' and j['conclusion'] == 'success'), ''))")
[ -n "$OTA_JOB" ] || fail "2. ota job of run #$N didn't succeed"
PUBLISHED=$(curl -sL -H "$H" "https://api.github.com/repos/$REPO/actions/jobs/$OTA_JOB/logs" | grep -o 'published [^ ]* for android runtime n-[0-9a-f]*' | tail -1)
[ -n "$PUBLISHED" ] || fail "2. no 'published' line in the ota log"
OTA_RUNTIME=${PUBLISHED##* }
echo "✓ 2. ota: $PUBLISHED"

# 4 (first, needs the APK). APK contents
curl -sfL -o "$WORK/Lens.apk" "https://github.com/$REPO/releases/download/dev-$N/Lens.apk" || fail "4. APK download failed"
APK_RUNTIME=$("$AAPT2" dump resources "$WORK/Lens.apk" | grep -A1 string/expo_runtime_version | grep -o 'n-[0-9a-f]*' | head -1)
"$AAPT2" dump xmltree "$WORK/Lens.apk" --file AndroidManifest.xml > "$WORK/manifest.txt"
grep -A2 'updates.ENABLED' "$WORK/manifest.txt" | grep -q '=true' || fail "4. updates not enabled in the APK"
UPDATE_URL=$(grep -o 'https://[a-z0-9.-]*/v1/updates' "$WORK/manifest.txt" | head -1)
[ -n "$UPDATE_URL" ] || fail "4. no update URL in the APK"
python3 - "$WORK/manifest.txt" "$ROOT/certs/certificate.pem" <<'EOF' || exit 1
import re, sys
m = open(sys.argv[1]).read()
i = m.index("CODE_SIGNING_CERTIFICATE")
apk = "".join(re.findall(r"[A-Za-z0-9+/=]{40,}", m[i:i + 4000]))
repo = "".join(l for l in open(sys.argv[2]).read().split("\n") if l and not l.startswith("-----"))
if repo not in apk: print("✗ 4. APK certificate differs from certs/certificate.pem"); sys.exit(1)
EOF
[ "$APK_RUNTIME" = "$OTA_RUNTIME" ] || fail "4. APK runtime $APK_RUNTIME != OTA runtime $OTA_RUNTIME"
echo "✓ 4. apk: runtime $APK_RUNTIME, updates enabled, $UPDATE_URL, certificate matches"

# 3. Live update API, as the phone asks
curl -s -D "$WORK/h.txt" -o "$WORK/ota.bin" -H "expo-protocol-version: 1" -H "expo-platform: android" \
  -H "expo-runtime-version: $APK_RUNTIME" -H "accept: multipart/mixed" \
  -H 'expo-expect-signature: sig, keyid="main", alg="rsa-v1_5-sha256"' "$UPDATE_URL"
grep -q "^HTTP/[0-9.]* 200" "$WORK/h.txt" || fail "3. update API didn't answer 200 for $APK_RUNTIME"
(cd "$ROOT" && node -e '
const fs = require("fs"), crypto = require("crypto");
const [hdrs, body, out] = process.argv.slice(1);
const bnd = fs.readFileSync(hdrs, "utf8").match(/boundary=("?)([^";\r\n]+)\1/i)[2];
const parts = fs.readFileSync(body).toString("latin1").split("--" + bnd).slice(1, -1);
for (const p of parts) {
  const [hd, ...rest] = p.replace(/^\r\n/, "").split("\r\n\r\n");
  if (!/name="manifest"/.test(hd)) continue;
  const manifest = rest.join("\r\n\r\n").replace(/\r\n$/, "");
  const sig = hd.match(/sig="([^"]+)"/)[1];
  const key = new crypto.X509Certificate(fs.readFileSync("certs/certificate.pem")).publicKey;
  if (!crypto.verify("RSA-SHA256", Buffer.from(manifest, "latin1"), key, Buffer.from(sig, "base64"))) { console.log("✗ 3. signature invalid"); process.exit(1); }
  const j = JSON.parse(Buffer.from(manifest, "latin1").toString("utf8"));
  fs.writeFileSync(out, `${j.launchAsset.url} ${j.launchAsset.hash} ${j.id}\n`);
}' "$WORK/h.txt" "$WORK/ota.bin" "$WORK/launch.txt")
read -r BUNDLE_URL BUNDLE_HASH UPDATE_ID < "$WORK/launch.txt"
GOT=$(curl -s "$BUNDLE_URL" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')
[ "$GOT" = "$BUNDLE_HASH" ] || fail "3. bundle SHA-256 mismatch"
echo "✓ 3. update API: 200, signature valid, bundle SHA-256 OK (update $UPDATE_ID)"
echo
echo "All checks passed → https://github.com/$REPO/releases/download/dev-$N/Lens.apk"
