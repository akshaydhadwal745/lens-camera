#!/usr/bin/env bash
# Plays "a friend": new identity → uploads friend.jpg → shares it with the Lens name given.
# Usage: friend_share.sh <recipient lens name> [token file to reuse]
set -euo pipefail
cd ~/camera-app/infra
API="$(node -p "require('./outputs.json').Lens.ApiUrl.replace(/\/$/, '')")/v1"
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(eval('o'+process.argv[1])??'')})" "$1"; }
call() { local m=$1 p=$2 t=$3; shift 3; curl -sS -X "$m" "$API$p" -H "authorization: Bearer $t" -H 'content-type: application/json' "$@"; }
HERE=$(dirname "$0"); TO=$1; TF=${2:-${TMPDIR:-/tmp}/lens-friend.token}
if [ -s "$TF" ]; then T=$(cut -d' ' -f1 "$TF"); N=$(cut -d' ' -f2 "$TF"); else A=$(curl -sS -X POST "$API/devices"); T=$(echo "$A" | j .token); N=$(echo "$A" | j .name); echo "$T $N" > "$TF"; fi
echo "friend = $N"
F=$HERE/../../infra/scripts/fixtures/gps.jpg; SIZE=$(stat -c %s "$F"); MD5=$(openssl dgst -md5 -binary "$F" | base64)
ID="$(node -p "Date.now().toString(36).padStart(8,'0')")-frnd$(printf %04d $((RANDOM%10000)))"
R=$(call POST /media "$T" -d "{\"id\":\"$ID\",\"contentType\":\"image/jpeg\",\"size\":$SIZE,\"kind\":\"photo\",\"md5\":\"$MD5\",\"width\":1600,\"height\":1200}")
curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: image/jpeg' -H "content-md5: $MD5" --data-binary @"$F" -o /dev/null
call POST "/media/$ID/complete" "$T" >/dev/null
U=$(call GET "/users?q=$TO" "$T"); RID=$(echo "$U" | j '.users[0].id'); echo "recipient: $(echo "$U" | j '.users[0].name') exact=$(echo "$U" | j '.users[0].exact')"
call POST /shares "$T" -d "{\"mediaIds\":[\"$ID\"],\"to\":[\"$RID\"]}" | j '.requests.map(r=>r.name+" "+r.status+" "+r.shareId).join(", ")'
echo "sent list:"; call GET /shares/out "$T" | j '.requests.map(r=>r.to.name+" "+r.status).join(", ")'
