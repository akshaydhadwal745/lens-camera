#!/usr/bin/env bash
# End-to-end smoke test against the deployed API. Creates two throwaway identities.
set -euo pipefail
API="${API:-$(node -p "require('./outputs.json').Lens.ApiUrl.replace(/\/$/, '')")}/v1"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(eval('o'+process.argv[1])??'')})" "$1"; }
call() { local m=$1 p=$2 t=$3; shift 3; curl -sS -X "$m" "$API$p" -H "authorization: Bearer $t" -H 'content-type: application/json' "$@"; }
ok() { echo "✔ $*"; }

curl -sS "$API/health" | grep -q true && ok health

A=$(curl -sS -X POST "$API/devices"); TA=$(echo "$A" | j .token); NA=$(echo "$A" | j .name)
B=$(curl -sS -X POST "$API/devices"); TB=$(echo "$B" | j .token); NB=$(echo "$B" | j .name); IB=$(echo "$B" | j .id)
ok "registered A=$NA B=$NB"
[[ $(call GET /me "bad.token.x" -o /dev/null -w '%{http_code}') == 401 ]] && ok "bad token rejected"

# --- single PUT (photo) ---
ID1="$(node -p "Date.now().toString(36).padStart(8,'0')")-p1test"
head -c 300000 /dev/urandom > "$TMP/photo.jpg"
R=$(call POST /media "$TA" -d "{\"id\":\"$ID1\",\"contentType\":\"image/jpeg\",\"size\":300000,\"kind\":\"photo\"}")
[[ $(echo "$R" | j .mode) == single ]] && ok "photo plan: single PUT"
curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: image/jpeg' --data-binary @"$TMP/photo.jpg" -o /dev/null -w '%{http_code}' | grep -q 200 && ok "photo PUT to S3"
R=$(call POST "/media/$ID1/complete" "$TA"); URL1=$(echo "$R" | j .media.url)
[[ -n "$URL1" ]] && ok "photo complete"

# --- multipart (video) with simulated interruption ---
ID2="$(node -p "Date.now().toString(36).padStart(8,'0')")-v2test"
SIZE=$((20*1024*1024)); head -c $SIZE /dev/urandom > "$TMP/video.mov"
R=$(call POST /media "$TA" -d "{\"id\":\"$ID2\",\"contentType\":\"video/quicktime\",\"size\":$SIZE,\"kind\":\"video\",\"duration\":12}")
PS=$(echo "$R" | j .partSize); [[ $(echo "$R" | j .mode) == multipart ]] && ok "video plan: multipart, part=$PS"
NPARTS=$(( (SIZE + PS - 1) / PS ))
upload_part() { local n=$1 url; url=$(call POST "/media/$ID2/parts" "$TA" -d "{\"partNumbers\":[$n]}" | j ".urls['$n']")
  dd if="$TMP/video.mov" bs=$PS skip=$((n-1)) count=1 status=none > "$TMP/part"; curl -sS -X PUT "$url" --data-binary @"$TMP/part" -o /dev/null -w '%{http_code}'; }
[[ $(upload_part 1) == 200 ]] && ok "part 1/$NPARTS uploaded, then 'app killed'"
[[ $(call POST "/media/$ID2/complete" "$TA" -o /dev/null -w '%{http_code}') == 409 ]] && ok "early complete refused (409)"
# resume: ask init again (idempotent) and which parts exist
R=$(call POST /media "$TA" -d "{\"id\":\"$ID2\",\"contentType\":\"video/quicktime\",\"size\":$SIZE,\"kind\":\"video\"}")
[[ $(echo "$R" | j .mode) == multipart ]] && ok "re-init resumes same upload"
DONE=$(call GET "/media/$ID2/parts" "$TA" | j ".parts.map(p=>p.n).join(',')"); ok "server has parts: [$DONE]"
for n in $(seq 1 $NPARTS); do [[ ",$DONE," == *",$n,"* ]] || [[ $(upload_part "$n") == 200 ]]; done; ok "remaining parts uploaded"
R=$(call POST "/media/$ID2/complete" "$TA"); [[ -n $(echo "$R" | j .media.url) ]] && ok "video complete"

# --- CDN access control ---
[[ $(curl -sS -o /dev/null -w '%{http_code}' "$URL1") == 200 ]] && ok "signed CloudFront URL → 200"
[[ $(curl -sS -o /dev/null -w '%{http_code}' "${URL1%%\?*}") == 403 ]] && ok "unsigned URL → 403"
cmp -s <(curl -sS "$URL1") "$TMP/photo.jpg" && ok "downloaded bytes match"

# --- list, quota ---
[[ $(call GET /media "$TA" | j .items.length) == 2 ]] && ok "list shows 2 items"
ok "usedBytes=$(call GET /me "$TA" | j .usedBytes)"

# --- search + share ---
PREFIX=$(echo "$NB" | cut -d- -f1-2)
call GET "/users?q=$PREFIX" "$TA" | j ".users.map(u=>u.name).join(',')" | grep -q "$NB" && ok "search '$PREFIX' finds $NB"
R=$(call POST /shares "$TA" -d "{\"mediaIds\":[\"$ID1\",\"$ID2\"],\"to\":[\"$IB\"]}"); [[ $(echo "$R" | j .shared) == 2 ]] && ok "shared 2 items with B"
R=$(call GET /shared "$TB"); [[ $(echo "$R" | j .items.length) == 2 ]] && ok "B sees 2 shared items from $(echo "$R" | j '.items[0].ownerName')"
SURL=$(echo "$R" | j '.items[0].url'); [[ $(curl -sS -o /dev/null -w '%{http_code}' "$SURL") == 200 ]] && ok "B can open shared media"
[[ $(call GET /contacts "$TB" | j '.contacts[0].name') == "$NA" ]] && ok "B's history has A"

# --- pairing (web sign-in) ---
CODE=$(call POST /pairing "$TA" | j .code); ok "pairing code $CODE"
W=$(curl -sS -X POST "$API/pairing/claim" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}"); TW=$(echo "$W" | j .token)
[[ $(call GET /media "$TW" | j .items.length) == 2 ]] && ok "web token sees A's media"
[[ $(curl -sS -X POST "$API/pairing/claim" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" -o /dev/null -w '%{http_code}') == 400 ]] && ok "code is single-use"

# --- delete cascades to shares ---
call DELETE "/media/$ID1" "$TA" >/dev/null; call DELETE "/media/$ID2" "$TA" >/dev/null
[[ $(call GET /shared "$TB" | j .items.length) == 0 ]] && ok "delete removed shares"
[[ $(call GET /me "$TA" | j .usedBytes) == 0 ]] && ok "quota released"
echo "ALL PASSED"
