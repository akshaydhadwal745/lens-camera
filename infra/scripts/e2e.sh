#!/usr/bin/env bash
# End-to-end smoke test against the deployed API. Creates two throwaway identities.
set -euo pipefail
API="${API:-$(node -p "require('./outputs.json').Lens.ApiUrl.replace(/\/$/, '')")}/v1"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(eval('o'+process.argv[1])??'')})" "$1"; }
call() { local m=$1 p=$2 t=$3; shift 3; curl -sS -X "$m" "$API$p" -H "authorization: Bearer $t" -H 'content-type: application/json' "$@"; }
ok() { echo "✔ $*"; }
fail() { echo "✘ $*"; exit 1; }
md5b64() { openssl dgst -md5 -binary "$1" | base64; }

curl -sS "$API/health" | grep -q true && ok health

A=$(curl -sS -X POST "$API/devices"); TA=$(echo "$A" | j .token); NA=$(echo "$A" | j .name)
B=$(curl -sS -X POST "$API/devices"); TB=$(echo "$B" | j .token); NB=$(echo "$B" | j .name); IB=$(echo "$B" | j .id)
ok "registered A=$NA B=$NB"
[[ $(call GET /me "bad.token.x" -o /dev/null -w '%{http_code}') == 401 ]] && ok "bad token rejected"

# --- single PUT (photo) ---
ID1="$(node -p "Date.now().toString(36).padStart(8,'0')")-p1test"
head -c 300000 /dev/urandom > "$TMP/photo.jpg"
PMD5=$(md5b64 "$TMP/photo.jpg")
R=$(call POST /media "$TA" -d "{\"id\":\"$ID1\",\"contentType\":\"image/jpeg\",\"size\":300000,\"kind\":\"photo\",\"md5\":\"$PMD5\"}")
[[ $(echo "$R" | j .mode) == single ]] && ok "photo plan: single PUT"
PURL=$(echo "$R" | j .url)
head -c 300000 /dev/urandom > "$TMP/corrupt.jpg"
[[ $(curl -sS -X PUT "$PURL" -H 'content-type: image/jpeg' -H "content-md5: $PMD5" --data-binary @"$TMP/corrupt.jpg" -o /dev/null -w '%{http_code}') == 400 ]] && ok "corrupted bytes rejected by S3 (BadDigest)" || fail "corrupted upload accepted"
[[ $(curl -sS -X PUT "$PURL" -H 'content-type: image/jpeg' -H "content-md5: $PMD5" --data-binary @"$TMP/photo.jpg" -o /dev/null -w '%{http_code}') == 200 ]] && ok "photo PUT to S3 with verified MD5"
R=$(call POST "/media/$ID1/complete" "$TA"); URL1=$(echo "$R" | j .media.url)
[[ -n "$URL1" ]] && ok "photo complete"

# --- multipart (video) with simulated interruption ---
ID2="$(node -p "Date.now().toString(36).padStart(8,'0')")-v2test"
SIZE=$((20*1024*1024)); head -c $SIZE /dev/urandom > "$TMP/video.mov"
R=$(call POST /media "$TA" -d "{\"id\":\"$ID2\",\"contentType\":\"video/quicktime\",\"size\":$SIZE,\"kind\":\"video\",\"duration\":12}")
PS=$(echo "$R" | j .partSize); [[ $(echo "$R" | j .mode) == multipart ]] && ok "video plan: multipart, part=$PS"
NPARTS=$(( (SIZE + PS - 1) / PS ))
upload_part() { local n=$1 url m
  dd if="$TMP/video.mov" bs=$PS skip=$((n-1)) count=1 status=none > "$TMP/part"; m=$(md5b64 "$TMP/part")
  url=$(call POST "/media/$ID2/parts" "$TA" -d "{\"parts\":[{\"n\":$n,\"md5\":\"$m\"}]}" | j ".urls['$n']")
  curl -sS -X PUT "$url" -H "content-md5: $m" --data-binary @"$TMP/part" -o /dev/null -w '%{http_code}'; }
[[ $(upload_part 1) == 200 ]] && ok "part 1/$NPARTS uploaded, then 'app killed'"
[[ $(call POST "/media/$ID2/complete" "$TA" -o /dev/null -w '%{http_code}') == 409 ]] && ok "early complete refused (409)"
# resume: ask init again (idempotent) and which parts exist
R=$(call POST /media "$TA" -d "{\"id\":\"$ID2\",\"contentType\":\"video/quicktime\",\"size\":$SIZE,\"kind\":\"video\"}")
[[ $(echo "$R" | j .mode) == multipart ]] && ok "re-init resumes same upload"
DONE=$(call GET "/media/$ID2/parts" "$TA" | j ".parts.map(p=>p.n).join(',')"); ok "server has parts: [$DONE]"
for n in $(seq 1 $NPARTS); do [[ ",$DONE," == *",$n,"* ]] || [[ $(upload_part "$n") == 200 ]]; done; ok "remaining parts uploaded"
R=$(call POST "/media/$ID2/complete" "$TA"); [[ -n $(echo "$R" | j .media.url) ]] && ok "video complete"

# --- preview-first: thumbnail + preview visible before the original ---
ID4="$(node -p "Date.now().toString(36).padStart(8,'0')")-preview1"
head -c 40000 /dev/urandom > "$TMP/thumb.jpg"; head -c 250000 /dev/urandom > "$TMP/preview.jpg"; head -c 2000000 /dev/urandom > "$TMP/orig.heic"
TM=$(md5b64 "$TMP/thumb.jpg"); PM=$(md5b64 "$TMP/preview.jpg"); OM=$(md5b64 "$TMP/orig.heic")
R=$(call POST /media "$TA" -d "{\"id\":\"$ID4\",\"contentType\":\"image/heic\",\"size\":2000000,\"kind\":\"photo\",\"md5\":\"$OM\",\"derivatives\":{\"thumb\":{\"md5\":\"$TM\",\"size\":40000},\"preview\":{\"md5\":\"$PM\",\"size\":250000}}}")
OURL=$(echo "$R" | j .url)
[[ $(curl -sS -X PUT "$(echo "$R" | j .derivativeUrls.thumb)" -H 'content-type: image/jpeg' -H "content-md5: $TM" --data-binary @"$TMP/thumb.jpg" -o /dev/null -w '%{http_code}') == 200 ]] && ok "thumbnail uploaded (MD5 verified)"
[[ $(curl -sS -X PUT "$(echo "$R" | j .derivativeUrls.preview)" -H 'content-type: image/jpeg' -H "content-md5: $PM" --data-binary @"$TMP/preview.jpg" -o /dev/null -w '%{http_code}') == 200 ]] && ok "preview uploaded (MD5 verified)"
R=$(call POST "/media/$ID4/previews" "$TA")
[[ $(echo "$R" | j .media.originalReady) == false && -n $(echo "$R" | j .media.previewUrl) ]] && ok "previews ready, original still pending"
L=$(call GET /media "$TA")
[[ $(echo "$L" | j ".items.find(i=>i.id==='$ID4').originalReady") == false ]] && ok "item listed on other devices before its original finished"
[[ $(curl -sS -o /dev/null -w '%{http_code}' "$(echo "$L" | j ".items.find(i=>i.id==='$ID4').thumbUrl")") == 200 ]] && ok "thumbnail served via CDN" || fail "thumbnail not served via CDN"
curl -sS -X PUT "$OURL" -H 'content-type: image/heic' -H "content-md5: $OM" --data-binary @"$TMP/orig.heic" -o /dev/null
R=$(call POST "/media/$ID4/complete" "$TA")
[[ $(echo "$R" | j .media.originalReady) == true && -n $(echo "$R" | j .media.url) ]] && ok "original completed; full-quality URL available"
cmp -s <(curl -sS "$(echo "$R" | j .media.url)") "$TMP/orig.heic" && ok "original bytes identical"

# --- non-destructive edit: new look, original untouched ---
head -c 41000 /dev/urandom > "$TMP/thumb2.jpg"; head -c 251000 /dev/urandom > "$TMP/preview2.jpg"
T2=$(md5b64 "$TMP/thumb2.jpg"); P2=$(md5b64 "$TMP/preview2.jpg")
E=$(call POST "/media/$ID4/edit" "$TA" -d "{\"edit\":{\"v\":1,\"look\":\"film\",\"intensity\":0.8,\"adjust\":{\"exposure\":0.3}},\"derivatives\":{\"thumb\":{\"md5\":\"$T2\",\"size\":41000},\"preview\":{\"md5\":\"$P2\",\"size\":251000}}}")
EV=$(echo "$E" | j .version)
curl -sS -X PUT "$(echo "$E" | j .derivativeUrls.thumb)" -H 'content-type: image/jpeg' -H "content-md5: $T2" --data-binary @"$TMP/thumb2.jpg" -o /dev/null
curl -sS -X PUT "$(echo "$E" | j .derivativeUrls.preview)" -H 'content-type: image/jpeg' -H "content-md5: $P2" --data-binary @"$TMP/preview2.jpg" -o /dev/null
C=$(call POST "/media/$ID4/edit/commit" "$TA" -d "{\"version\":$EV}")
[[ $(echo "$C" | j .media.edit.look) == film ]] && ok "edit saved (version $EV)" || fail "edit not saved: $C"
[[ $(echo "$C" | j .media.previewUrl) == *preview-v$EV.jpg* ]] && ok "preview switched to the edited version"
cmp -s <(curl -sS "$(echo "$C" | j .media.previewUrl)") "$TMP/preview2.jpg" && ok "edited preview served via CDN"
cmp -s <(curl -sS "$(echo "$C" | j .media.url)") "$TMP/orig.heic" && ok "original still byte-identical after edit"
[[ $(call POST "/media/$ID4/edit/commit" "$TA" -d "{\"version\":$EV}" -o /dev/null -w '%{http_code}') == 409 ]] && ok "stale commit rejected"
call DELETE "/media/$ID4" "$TA" >/dev/null
BUCKET=$(node -p "require('./outputs.json').Lens.MediaBucket")
aws s3api head-object --profile lens --bucket "$BUCKET" --key "d/$(echo "$A" | j .id)/$ID4/preview-v$EV.jpg" >/dev/null 2>&1 && fail "preview not deleted" || ok "delete removed thumbnail + preview"

# --- storage class + large-file planning ---
BUCKET=$(node -p "require('./outputs.json').Lens.MediaBucket")
SC=$(aws s3api head-object --profile lens --bucket "$BUCKET" --key "m/$(echo "$A" | j .id)/$ID2.mov" --query StorageClass --output text)
[[ "$SC" == INTELLIGENT_TIERING ]] && ok "original stored in Intelligent-Tiering" || fail "storage class is $SC"
ID3="$(node -p "Date.now().toString(36).padStart(8,'0')")-big100g"
R=$(call POST /media "$TA" -d "{\"id\":\"$ID3\",\"contentType\":\"video/quicktime\",\"size\":$((90*1024*1024*1024)),\"kind\":\"video\"}")
BPS=$(echo "$R" | j .partSize); NP=$(( (90*1024*1024*1024 + BPS - 1) / BPS ))
(( NP <= 10000 )) && ok "90 GB plan: part size $((BPS/1024/1024)) MiB → $NP parts (S3 max 10,000)" || fail "too many parts: $NP"
call DELETE "/media/$ID3" "$TA" >/dev/null && ok "abandoned 90 GB upload aborted"

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
