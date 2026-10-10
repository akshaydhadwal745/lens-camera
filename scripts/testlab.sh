#!/usr/bin/env bash
# Runs the camera self-test on real phones in Firebase Test Lab ("game loop")
# and prints each phone's result (docs/features/self-test.md).
#
# Usage: scripts/testlab.sh <build number> [model/version ...]
#   scripts/testlab.sh 36                       # default phone set
#   scripts/testlab.sh 36 akita/34 a14xm/34     # pick phones
# 32-bit-only phones get Lens-32bit.apk automatically (list them with :32,
# e.g. a10/29:32). Free plan: 5 physical phones per day.
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
OUT=${OUT:-$(pwd)/testlab-dev-$N}
mkdir -p "$OUT"

run_matrix() { # apk-name devices...
  local apk=$1; shift
  curl -sfL -o "$WORK/$apk" "https://github.com/$REPO/releases/download/dev-$N/$apk"
  local args=()
  for d in "$@"; do args+=(--device "model=${d%/*},version=${d#*/}"); done
  "$G" firebase test android run --project "$PROJECT" --type game-loop --scenario-numbers 1 \
    --app "$WORK/$apk" "${args[@]}" --timeout 600s --async --format=json 2>"$WORK/run.log" | python3 -c 'import sys,json;print(json.load(sys.stdin)["testMatrixId"])' \
    || { cat "$WORK/run.log"; exit 1; }
}

P64=(); P32=()
for p in "${PHONES[@]}"; do
  if [[ $p == *:32 ]]; then P32+=("${p%:32}"); else P64+=("$p"); fi
done
MATRICES=()
[ ${#P64[@]} -gt 0 ] && MATRICES+=("$(run_matrix Lens.apk "${P64[@]}")")
[ ${#P32[@]} -gt 0 ] && MATRICES+=("$(run_matrix Lens-32bit.apk "${P32[@]}")")
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

# Each phone's self-test result file (written by the app).
python3 - "$OUT" <<'EOF'
import json, sys
from pathlib import Path
found = False
for f in sorted(Path(sys.argv[1]).rglob("*.json")):
    try:
        r = json.loads(f.read_text())
    except Exception:
        continue
    if "steps" not in r:
        continue
    found = True
    print(f"\n{f.relative_to(sys.argv[1]).parts[0]}: {r['passed']} passed, {r['failed']} failed, {r['skipped']} skipped ({r['totalMs'] / 1000:.0f} s)")
    for s in r["steps"]:
        mark = {"pass": "✓", "fail": "✗", "skip": "–"}[s["status"]]
        d = s.get("details") or {}
        size = f" {d.get('saved')} of {d.get('max')}" if d.get("saved") else ""
        print(f"  {mark} {s['label']}{size}{' — ' + s['message'] if s.get('message') else ''}")
if not found:
    print("\nNo self-test result files found; check the Test Lab console videos/logcat in", sys.argv[1])
EOF
