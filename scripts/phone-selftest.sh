#!/usr/bin/env bash
# Runs the in-app self-test on a phone connected to this PC (USB or Wi-Fi adb), the same
# way Firebase Test Lab does (TEST_LOOP intent), and saves the result + logcat where
# scripts/testlab-summary.py / test-report.py read them. Free, no daily quota.
#
# Usage: scripts/phone-selftest.sh <build number> <adb serial> [out dir]
#   scripts/phone-selftest.sh 125 192.180.2.204:5555
# Installs dev-N's Lens.apk first (same signing key: the app's data stays). PIN unlocks
# the screen if set (PIN=8866). The phone needs internet for the upload/model steps.
set -euo pipefail

N=${1:?usage: phone-selftest.sh <build number> <adb serial> [out dir]}
SERIAL=${2:?adb serial, e.g. 192.180.2.204:5555}
OUT=${3:-$(pwd)/test-results/dev-$N/phones}
REPO=akshaydhadwal745/lens-camera
PKG=com.instagrowapp.lens
source ~/.local/bin/android-env.sh 2>/dev/null || true
A=(timeout 60 adb -s "$SERIAL")
case "$SERIAL" in *:*) adb connect "$SERIAL" >/dev/null 2>&1 || true ;; esac
"${A[@]}" get-state >/dev/null || { echo "phone $SERIAL not reachable over adb"; exit 1; }

MODEL=$("${A[@]}" shell getprop ro.product.model | tr -d '\r ')
OSV=$("${A[@]}" shell getprop ro.build.version.release | tr -d '\r ')
DIR="$OUT/$MODEL-$OSV-local"
mkdir -p "$DIR"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

HAVE=$("${A[@]}" shell dumpsys package $PKG | grep -m1 -o 'versionCode=[0-9]*' | cut -d= -f2 || true)
if [ "$HAVE" != "$N" ]; then
  echo "installing dev-$N on $MODEL (had ${HAVE:-none})"
  curl -sfL -o "$WORK/Lens.apk" "https://github.com/$REPO/releases/download/dev-$N/Lens.apk"
  timeout 600 adb -s "$SERIAL" install -r "$WORK/Lens.apk" | tail -1
fi

# Awake + unlocked, home screen.
"${A[@]}" shell input keyevent KEYCODE_WAKEUP
if [ -n "${PIN:-}" ] && "${A[@]}" shell dumpsys window | grep -q "mDreamingLockscreen=true\|mShowingLockscreen=true"; then
  "${A[@]}" shell input swipe 540 1800 540 600 200; sleep 1
  "${A[@]}" shell input text "$PIN"; "${A[@]}" shell input keyevent KEYCODE_ENTER; sleep 2
fi
"${A[@]}" shell input keyevent KEYCODE_HOME
"${A[@]}" shell ping -c1 -W3 google.com >/dev/null 2>&1 || echo "warning: $MODEL has no internet (upload/model steps will fail)"

R=/sdcard/Android/data/$PKG/files/selftest.json
"${A[@]}" shell mkdir -p "$(dirname $R)"
"${A[@]}" shell rm -f $R
"${A[@]}" logcat -c || true
"${A[@]}" shell am start -a com.google.intent.action.TEST_LOOP -t application/javascript -d "file://$R" -n $PKG/.MainActivity --ei scenario 1 >/dev/null
echo "self-test running on $MODEL (Android $OSV)…"
for i in $(seq 1 120); do
  sleep 10
  [ "$("${A[@]}" shell "[ -s $R ] && echo y" 2>/dev/null | tr -d '\r')" = y ] && break
done
sleep 3
"${A[@]}" pull $R "$DIR/selftest.json" >/dev/null || echo "no result file after $((i * 10)) s"
"${A[@]}" logcat -d > "$DIR/logcat.txt" || true
echo "→ $DIR"
