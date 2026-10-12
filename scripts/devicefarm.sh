#!/usr/bin/env bash
# Runs the Lens camera self-test on real phones in AWS Device Farm (us-west-2),
# like scripts/testlab.sh does on Firebase Test Lab. Each phone's report goes to
# our diagnostics store (research/diagnostics.py); the logcat and screen video
# land in $OUT. Costs device minutes (1,000 free once, then $0.17/minute):
# the script prints the minutes each run used.
#
# Usage: scripts/devicefarm.sh <build number> "<device name>|<os>" ...
#   scripts/devicefarm.sh 68 "Samsung Galaxy S9 (Unlocked)|9" "Samsung Galaxy S25 Ultra|15"
# Device names: aws devicefarm list-devices --region us-west-2 --profile lens
set -euo pipefail

N=${1:?usage: devicefarm.sh <build number> "<device name>|<os>" ...}
shift
[ $# -gt 0 ] || { echo "name at least one device"; exit 1; }
REPO=akshaydhadwal745/lens-camera
AWSDF=(aws devicefarm --region us-west-2 --profile "${AWS_PROFILE:-lens}" --output json)
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-$(pwd)/devicefarm-dev-$N}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

# Project (created once).
PROJECT=$("${AWSDF[@]}" list-projects | j "next((p['arn'] for p in d['projects'] if p['name']=='Lens self-test'), '')")
[ -n "$PROJECT" ] || PROJECT=$("${AWSDF[@]}" create-project --name "Lens self-test" --default-job-timeout-minutes 15 | j "d['project']['arn']")

upload() { # file type → upload arn (waits until processed)
  local file=$1 type=$2 arn url status
  read -r arn url < <("${AWSDF[@]}" create-upload --project-arn "$PROJECT" --name "$(basename "$file")" --type "$type" | j "d['upload']['arn'] + ' ' + d['upload']['url']")
  curl -sf -T "$file" "$url" >/dev/null
  for _ in $(seq 1 60); do
    status=$("${AWSDF[@]}" get-upload --arn "$arn" | j "d['upload']['status']")
    [ "$status" = SUCCEEDED ] && { echo "$arn"; return; }
    [ "$status" = FAILED ] && { "${AWSDF[@]}" get-upload --arn "$arn" | j "d['upload'].get('metadata')" >&2; exit 1; }
    sleep 5
  done
  echo "upload $file not processed" >&2; exit 1
}

curl -sfL -o "$WORK/Lens.apk" "https://github.com/$REPO/releases/download/dev-$N/Lens.apk"
(cd "$HERE/devicefarm/package" && zip -qr "$WORK/tests.zip" .)
cp "$HERE/devicefarm/testspec.yml" "$WORK/lens-selftest.yml"
APP=$(upload "$WORK/Lens.apk" ANDROID_APP)
TESTS=$(upload "$WORK/tests.zip" APPIUM_PYTHON_TEST_PACKAGE)
SPEC=$(upload "$WORK/lens-selftest.yml" APPIUM_PYTHON_TEST_SPEC)

# The phones asked for (exact name + OS version).
"${AWSDF[@]}" list-devices --filters attribute=PLATFORM,operator=EQUALS,values=ANDROID > "$WORK/devices.json"
ARNS=$(python3 - "$WORK/devices.json" "$@" <<'EOF'
import json, sys
devices = json.load(open(sys.argv[1]))["devices"]
arns = []
for want in sys.argv[2:]:
    name, os_ = want.split("|")
    hit = [d for d in devices if d["name"] == name and d["os"] == os_]
    if not hit:
        sys.exit(f"no device {want}")
    arns.append(hit[0]["arn"])
print(json.dumps(arns))
EOF
)
POOL=$("${AWSDF[@]}" create-device-pool --project-arn "$PROJECT" --name "dev-$N $(date +%H%M%S)" \
  --rules "[{\"attribute\":\"ARN\",\"operator\":\"IN\",\"value\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$ARNS")}]" | j "d['devicePool']['arn']")

RUN=$("${AWSDF[@]}" schedule-run --project-arn "$PROJECT" --app-arn "$APP" --device-pool-arn "$POOL" --name "dev-$N self-test" \
  --test "type=APPIUM_PYTHON,testPackageArn=$TESTS,testSpecArn=$SPEC" \
  --execution-configuration jobTimeoutMinutes=15,videoCapture=true | j "d['run']['arn']")
echo "Started $RUN (results → $OUT)"

while :; do
  "${AWSDF[@]}" get-run --arn "$RUN" > "$WORK/run.json"
  [ "$(j "d['run']['status']" < "$WORK/run.json")" = COMPLETED ] && break
  sleep 30
done
python3 - "$WORK/run.json" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))["run"]
m = r.get("deviceMinutes", {})
print(f"\nrun {r['result']}: {r.get('counters')}\ndevice minutes: {m.get('total')} (metered {m.get('metered')})")
EOF

# Each phone: result, then its logcat + video.
"${AWSDF[@]}" list-jobs --arn "$RUN" > "$WORK/jobs.json"
python3 -c "import json; [print(j['arn'], j['device']['name'].replace(' ', '_') + '-' + j['device']['os'], j['result']) for j in json.load(open('$WORK/jobs.json'))['jobs']]" |
while read -r job name result; do
  echo "  $name: $result"
  mkdir -p "$OUT/$name"
  "${AWSDF[@]}" list-artifacts --arn "$job" --type FILE > "$WORK/a.json"
  python3 -c "import json; [print(a['url'], a['name'].replace(' ', '_') + '.' + a['extension']) for a in json.load(open('$WORK/a.json'))['artifacts']]" |
    while read -r url file; do curl -sfL -o "$OUT/$name/$file" "$url" || true; done
done
echo
echo "Reports: research/.venv/bin/python research/diagnostics.py --days 1   (self-test events from these phones)"
python3 "$HERE/testlab-summary.py" "$OUT" | grep -E "^===|logcat" || true
