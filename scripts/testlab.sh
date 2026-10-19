#!/usr/bin/env bash
# Runs the camera self-test on real phones in Firebase Test Lab ("game loop")
# and prints each phone's result (docs/features/self-test.md).
#
# Usage: scripts/testlab.sh <build number> [model/version ...]
#   scripts/testlab.sh 36                       # default phone set
#   scripts/testlab.sh 36 akita/34 a14xm/34     # pick phones
# 32-bit-only phones get Lens-32bit.apk automatically (list them with :32,
# e.g. a10/29:32). Free plan: 5 physical + 10 virtual phones per day; the day
# resets at midnight Pacific time (12:30 IST), TEST_QUOTA_EXCEEDED until then.
#   TYPE=robo scripts/testlab.sh 67 MediumPhone.arm/35   # Robo crawls the real app
#   screens (camera, roll, viewer, settings) looking for crashes, instead of the self-test.
# Results: scripts/testlab-summary.py (self-test steps, probes, logcat crashes).
set -euo pipefail

N=${1:?usage: testlab.sh <build number> [model/version ...]}
shift
REPO=akshaydhadwal745/lens-camera
PROJECT=${FIREBASE_PROJECT:-lens-5df67}
G=${GCLOUD:-$HOME/.local/google-cloud-sdk/bin/gcloud}
# High-availability phones: budget Samsung, OPPO, Pixel, Motorola, old Android.
PHONES=("$@")
[ ${#PHONES[@]} -gt 0 ] || PHONES=(a14xm/34 OP573DL1/34 akita/34 dubai/34 F01L/27)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
OUT=${OUT:-$(pwd)/testlab-dev-$N}
mkdir -p "$OUT"

run_matrix() { # apk-name devices...
  local apk=$1; shift
  curl -sfL -o "$WORK/$apk" "https://github.com/$REPO/releases/download/dev-$N/$apk"
  local args=()
  for d in "$@"; do args+=(--device "model=${d%/*},version=${d#*/}"); done
  # 15 min: budget phones on Test Lab racks can spend minutes waiting for Play services to
  # download the ML Kit models; at 10 min the A14 (dev-136) and OnePlus (dev-131) were cut off
  # mid-run with no result. Override with SELFTEST_TIMEOUT=600s.
  local type=(--type game-loop --scenario-numbers 1 --timeout "${SELFTEST_TIMEOUT:-900s}")
  [ "${TYPE:-}" = robo ] && type=(--type robo --timeout 300s)
  "$G" firebase test android run --project "$PROJECT" "${type[@]}" \
    --app "$WORK/$apk" "${args[@]}" --async >/dev/null 2>"$WORK/run.log" || { grep -E "ERROR|Reason" "$WORK/run.log" >&2; exit 1; }
  # gcloud's stdout format varies (id or console link); its log always names the matrix.
  grep -o 'matrix-[a-z0-9]*' "$WORK/run.log" | head -1
}

MATRICES=()
if [ -n "${MATRIX:-}" ]; then
  MATRICES=("$MATRIX") # follow an already-started run
else
P64=(); P32=()
for p in "${PHONES[@]}"; do
  if [[ $p == *:32 ]]; then P32+=("${p%:32}"); else P64+=("$p"); fi
done
[ ${#P64[@]} -gt 0 ] && MATRICES+=("$(run_matrix Lens.apk "${P64[@]}")")
[ ${#P32[@]} -gt 0 ] && MATRICES+=("$(run_matrix Lens-32bit.apk "${P32[@]}")")
fi
echo "Started: ${MATRICES[*]} (results → $OUT)"

TOKEN=$("$G" auth print-access-token)
for m in "${MATRICES[@]}"; do
  while :; do
    STATE=$(curl -s -H "Authorization: Bearer $TOKEN" "https://testing.googleapis.com/v1/projects/$PROJECT/testMatrices/$m")
    echo "$STATE" > "$WORK/$m.json"
    S=$(python3 -c 'import sys,json;print(json.load(open(sys.argv[1]))["state"])' "$WORK/$m.json")
    [[ $S == FINISHED || $S == ERROR || $S == INVALID ]] && break
    sleep 30
    TOKEN=$("$G" auth print-access-token)
  done
  python3 - "$WORK/$m.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"\nmatrix {d['testMatrixId']}: {d['state']} {d.get('outcomeSummary', '')}")
for e in d.get("testExecutions", []):
    dev = e["environment"]["androidDevice"]
    t = e.get("testDetails") or {}
    print(f"  {dev['androidModelId']}/{dev['androidVersionId']}: {e.get('state')} {t.get('errorMessage') or ''}")
EOF
  GCS=$(python3 -c 'import sys,json;print(json.load(open(sys.argv[1]))["resultStorage"]["googleCloudStorage"]["gcsPath"])' "$WORK/$m.json")
  "$G" storage cp -r "$GCS*" "$OUT/" >/dev/null 2>&1 || true
done

# Each phone: self-test steps, feature probes, Lens crashes/freezes in the logcat.
python3 "$(dirname "$0")/testlab-summary.py" "$OUT"
