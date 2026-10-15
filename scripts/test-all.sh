#!/usr/bin/env bash
# Tests everything for one build and writes one report (test-results/dev-N/REPORT.md):
#   1. release   scripts/verify-release.sh: APK, OTA publish, signed update API, runtime
#   2. phones    Firebase Test Lab, 5 real phones (budget → flagship, old Android):
#                the in-app self-test (game loop): every camera mode, video, export,
#                editor, Play services models, People, upload, heat … + logcat crashes
#   3. screens   Firebase Test Lab Robo on virtual phones: crawls the real app
#                (camera, roll, viewer, settings, sign-in …) looking for crashes/freezes
#   4. api       infra/scripts/e2e.sh against the live API (accounts, uploads,
#                sharing, events, recaps, referrals, trash, storage …)
#   5. website   the live site's key pages, downloads/latest.json, update API
#   + LOCAL="<adb serial> …": the same self-test on phones connected to this PC
#     (scripts/phone-selftest.sh; free, no quota), reported with the Test Lab phones
#
# Usage: scripts/test-all.sh <build number>
#   SKIP="robo api" scripts/test-all.sh 124      # leave parts out
#   LOCAL=192.180.2.204:5555 PIN=8866 scripts/test-all.sh 125   # + the S8 on Wi-Fi adb
#   PHONES="a14xm/34 akita/34" ROBO="MediumPhone.arm/35" scripts/test-all.sh 124
# Free Test Lab plan: 5 physical + 10 virtual phones a day; the day resets at
# midnight Pacific (12:30 IST), TEST_QUOTA_EXCEEDED until then.
set -uo pipefail

N=${1:?usage: test-all.sh <build number>}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${OUT:-$ROOT/test-results/dev-$N}
SITE=${SITE:-https://lens.instagrowapp.com}
# Galaxy A14 (budget Samsung), OPPO A79 (budget), Pixel 8a (mid), Galaxy S22 Ultra (flagship),
# Fujitsu F-01L (Android 8.1): all high-capacity models, so they don't sit in the queue.
PHONES=${PHONES:-"a14xm/34 OP573DL1/34 akita/34 b0q/33 F01L/27"}
ROBO=${ROBO:-"MediumPhone.arm/35 SmallPhone.arm/33"}
mkdir -p "$OUT"
source ~/.nvm/nvm.sh >/dev/null 2>&1 || true
skip() { [[ " ${SKIP:-} " == *" $1 "* ]]; }
status() { echo "$2" > "$OUT/$1.status"; }

echo "Testing dev-$N → $OUT"

# 2 + 3 take longest (queue + 10 min per phone): start them first, in the background.
if ! skip phones; then
  ( OUT="$OUT/phones" "$ROOT/scripts/testlab.sh" "$N" $PHONES > "$OUT/phones.log" 2>&1 && status phones done || status phones error ) &
fi
if ! skip robo; then
  ( OUT="$OUT/robo" TYPE=robo "$ROOT/scripts/testlab.sh" "$N" $ROBO > "$OUT/robo.log" 2>&1 && status robo done || status robo error ) &
fi

if ! skip release; then
  echo "· release checks"
  "$ROOT/scripts/verify-release.sh" "$N" > "$OUT/release.log" 2>&1 && status release pass || status release fail
fi

if ! skip api; then
  echo "· API end-to-end checks"
  (cd "$ROOT/infra" && ./scripts/e2e.sh) > "$OUT/api.log" 2>&1 && status api pass || status api fail
fi

if ! skip website; then
  echo "· website checks"
  {
    for p in / /hi/ /download/ /features/night-mode/ /pricing/ /contact/ /signin/ /e/ /privacy/ /terms/ /app/ /downloads/android/latest.json; do
      code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE$p")
      [ "$code" = 200 ] && echo "✔ $p 200" || echo "✘ $p $code"
    done
    latest=$(curl -s "$SITE/downloads/android/latest.json")
    echo "latest.json: $(echo "$latest" | tr -d "\n " | cut -c1-160)"
    for apk in $(echo "$latest" | python3 -c 'import sys,json; [print(f["url"]) for f in json.load(sys.stdin)["files"].values()]' 2>/dev/null); do
      code=$(curl -sI -o /dev/null -w '%{http_code}' "$apk")
      [ "$code" = 200 ] && echo "✔ public APK downloads ($apk)" || echo "✘ public APK $code ($apk)"
    done
    curl -s "$SITE/.well-known/assetlinks.json" | grep -q "BD:D5:7B:A5" && echo "✔ assetlinks.json has the release key" || echo "✘ assetlinks.json missing the release key"
  } > "$OUT/website.log" 2>&1
  grep -q '^✘' "$OUT/website.log" && status website fail || status website pass
fi

for serial in ${LOCAL:-}; do
  echo "· self-test on local phone $serial"
  PIN=${PIN:-} "$ROOT/scripts/phone-selftest.sh" "$N" "$serial" "$OUT/phones" > "$OUT/local-$serial.log" 2>&1 || echo "  local phone $serial: see $OUT/local-$serial.log"
done

[ -n "${LOCAL:-}" ] && skip phones && status phones done

echo "· waiting for Test Lab (phones + robo)…"
wait
python3 "$ROOT/scripts/test-report.py" "$N" "$OUT"
