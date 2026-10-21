#!/usr/bin/env bash
# End-to-end smoke test against the deployed API. Creates two throwaway identities.
set -euo pipefail
API="${API:-$(node -p "require('./outputs.json').Lens.ApiUrl.replace(/\/$/, '')")}/v1"
# Every request is marked as test traffic: accounts it makes stay out of the console's numbers.
curl() { command curl -H 'x-lens-test: 1' "$@"; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(eval('o'+process.argv[1])??'')})" "$1"; }
call() { local m=$1 p=$2 t=$3; shift 3; curl -sS -X "$m" "$API$p" -H "authorization: Bearer $t" -H 'content-type: application/json' "$@"; }
ok() { echo "✔ $*"; }
fail() { echo "✘ $*"; exit 1; }
md5b64() { openssl dgst -md5 -binary "$1" | base64; }
# Number of S3 object versions + delete markers under a prefix.
vcount() { aws s3api list-object-versions --profile lens --bucket "$BUCKET" --prefix "$1" --output json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=d.trim()?JSON.parse(d):{};console.log((o.Versions||[]).length+(o.DeleteMarkers||[]).length)})"; }

curl -sS "$API/health" | grep -q true && ok health

A=$(curl -sS -X POST "$API/devices"); TA=$(echo "$A" | j .token); NA=$(echo "$A" | j .name)
B=$(curl -sS -X POST "$API/devices"); TB=$(echo "$B" | j .token); NB=$(echo "$B" | j .name); IB=$(echo "$B" | j .id)
ok "registered A=$NA B=$NB"
# A signs in (guests are capped at 5 GB; the big-file tests need the account quota).
otp() { aws dynamodb get-item --profile lens --table-name Lens --key "{\"pk\":{\"S\":\"OTP#$1\"},\"sk\":{\"S\":\"CODE\"}}" --query Item.testCode.S --output text; }
MAILA="a$(date +%s%N)@e2e.lens.invalid"
curl -sS -X POST "$API/auth/email/start" -H "authorization: Bearer $TA" -H 'content-type: application/json' -d "{\"email\":\"$MAILA\"}" >/dev/null
curl -sS -X POST "$API/auth/email/verify" -H "authorization: Bearer $TA" -H 'content-type: application/json' -d "{\"email\":\"$MAILA\",\"code\":\"$(otp "$MAILA")\"}" >/dev/null
[[ $(curl -sS "$API/me" -H "authorization: Bearer $TA" | j .quotaBytes) == $((100*1024*1024*1024)) ]] && ok "signed-in account: 100 GB"
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
[[ $(call DELETE "/media/$ID4" "$TA" | j .phase) == trash ]] && ok "delete moves to Trash"
[[ $(call DELETE "/media/$ID4/forever" "$TA" | j .phase) == gone ]] && ok "delete forever"
BUCKET=$(node -p "require('./outputs.json').Lens.MediaBucket")
[[ $(vcount "d/$(echo "$A" | j .id)/$ID4/") == 0 ]] && ok "delete forever removed every version of thumbnail + preview" || fail "thumbnail + preview versions left"
[[ $(vcount "m/$(echo "$A" | j .id)/$ID4.") == 0 ]] && ok "delete forever removed every version of the original" || fail "the original versions left"

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

# --- search + share requests (docs/design/sharing-consent.md) ---
IA=$(echo "$A" | j .id)
[[ $(call GET "/users?q=$(echo "$NB" | cut -c1-2)" "$TA" | j .users.length) == 0 ]] && ok "2-letter search returns nothing (no name scraping)"
R=$(call GET "/users?q=$NB" "$TA"); [[ $(echo "$R" | j '.users[0].name') == "$NB" && $(echo "$R" | j '.users[0].exact') == true ]] && ok "exact name comes first ($NB)"
[[ $(call GET "/users/$IB" "$TA" | j .user.name) == "$NB" ]] && ok "QR lookup finds exactly $NB"
inid() { call GET /shares/in "$TB" | j ".requests.find(r=>r.shareId==='$1')?.status"; }
R=$(call POST /shares "$TA" -d "{\"mediaIds\":[\"$ID1\",\"$ID2\"],\"to\":[\"$IB\"]}")
S1=$(echo "$R" | j '.requests[0].shareId'); [[ $(echo "$R" | j '.requests[0].status') == pending ]] && ok "share to B starts as a request ($S1)"
[[ $(call GET /shared "$TB" | j .items.length) == 0 ]] && ok "B can't see anything before accepting"
R=$(call GET /shares/in "$TB"); [[ $(echo "$R" | j .pending) == 1 && $(echo "$R" | j '.requests[0].from.name') == "$NA" ]] && ok "B's inbox: 1 waiting from $NA"
[[ $(echo "$R" | j '.requests[0].thumbs') == "" && $(echo "$R" | j '.requests[0].knownSender') == false ]] && ok "first-time sender: no thumbnails until asked"
R=$(call GET "/shares/in/$S1?previews=1" "$TB"); [[ $(echo "$R" | j .thumbs.length) == 2 ]] && ok "Show previews: 2 thumbnails"
[[ $(echo "$R" | j '.thumbs.every(t=>!t.url&&!t.previewUrl)') == true ]] && ok "previews never include the original or full preview"
[[ $(call GET /shares/out "$TA" | j '.requests[0].to.name') == "$NB" ]] && ok "A's Sent list shows the request to $NB"
[[ $(call POST "/shares/out/$S1/cancel" "$TA" | j .status) == cancelled ]] && ok "A cancels while pending"
[[ $(inid "$S1") == cancelled ]] && ok "B sees it cancelled"
[[ $(call POST "/shares/in/$S1/accept" "$TB" -o /dev/null -w '%{http_code}') == 409 ]] && ok "a cancelled share can't be accepted"
S2=$(call POST /shares "$TA" -d "{\"mediaIds\":[\"$ID1\",\"$ID2\"],\"to\":[\"$IB\"]}" | j '.requests[0].shareId')
[[ $(call POST "/shares/in/$S2/accept" "$TB" | j .count) == 2 ]] && ok "B accepts 2 items"
R=$(call GET /shared "$TB"); [[ $(echo "$R" | j .items.length) == 2 ]] && ok "B sees 2 shared items from $(echo "$R" | j '.items[0].ownerName')"
SURL=$(echo "$R" | j '.items[0].url'); [[ $(curl -sS -o /dev/null -w '%{http_code}' "$SURL") == 200 ]] && ok "B can open shared media"
[[ $(call GET /contacts "$TB" | j '.contacts[0].name') == "$NA" ]] && ok "B's history has A (after accepting)"
[[ $(call GET /shares/out "$TA" | j ".requests.find(r=>r.shareId==='$S2').status") == accepted ]] && ok "A sees accepted"
[[ $(call POST "/shares/out/$S2/cancel" "$TA" | j .status) == revoked ]] && ok "A revokes after acceptance"
[[ $(call GET /shared "$TB" | j .items.length) == 0 ]] && ok "B's access ends at once"
S3=$(call POST /shares "$TA" -d "{\"mediaIds\":[\"$ID1\",\"$ID2\"],\"to\":[\"$IB\"]}" | j '.requests[0].shareId')
call POST "/shares/in/$S3/accept" "$TB" -d '{"alwaysAccept":true}' >/dev/null
[[ $(call GET /contacts "$TB" | j '.contacts[0].trusted') == true ]] && ok "B: always accept from A"
R=$(call POST /shares "$TA" -d "{\"mediaIds\":[\"$ID1\"],\"to\":[\"$IB\"]}"); [[ $(echo "$R" | j '.requests[0].status') == accepted ]] && ok "next share from A arrives accepted"
[[ $(call GET /shared "$TB" | j .items.length) == 2 ]] && ok "B still has the 2 items (no duplicates)"
# Expiry (7 days): age a fresh request in the database, then try to accept it.
call PUT "/contacts/$IA" "$TB" -d '{"trusted":false}' >/dev/null
S4=$(call POST /shares "$TA" -d "{\"mediaIds\":[\"$ID2\"],\"to\":[\"$IB\"]}" | j '.requests[0].shareId')
for K in "D#$IB|IN#$S4" "D#$IA|OUT#$S4"; do
  aws dynamodb update-item --profile lens --table-name Lens --key "{\"pk\":{\"S\":\"${K%%|*}\"},\"sk\":{\"S\":\"${K##*|}\"}}" \
    --update-expression 'SET expiresAt = :e' --expression-attribute-values '{":e":{"N":"1000"}}'
done
[[ $(inid "$S4") == expired ]] && ok "unanswered request shows expired"
[[ $(call POST "/shares/in/$S4/accept" "$TB" -o /dev/null -w '%{http_code}') == 409 ]] && ok "an expired share can't be accepted"
# Decline + block: a blocked sender's new shares never reach the inbox.
S5=$(call POST /shares "$TA" -d "{\"mediaIds\":[\"$ID2\"],\"to\":[\"$IB\"]}" | j '.requests[0].shareId')
[[ $(call POST "/shares/in/$S5/decline" "$TB" -d '{"block":true}' | j .blocked) == true ]] && ok "B declines and blocks A"
S6=$(call POST /shares "$TA" -d "{\"mediaIds\":[\"$ID2\"],\"to\":[\"$IB\"]}" | j '.requests[0].shareId')
[[ $(inid "$S6") == "" ]] && ok "blocked sender's share doesn't arrive"
[[ $(call GET /shares/out "$TA" | j ".requests.find(r=>r.shareId==='$S6').status") == pending ]] && ok "A just sees it waiting (the block isn't revealed)"
[[ $(call GET /shares/out "$TA" | j ".requests.find(r=>r.shareId==='$S6').mediaIds.length") -ge 1 ]] && ok "A's Sent list carries A's own item ids (People smart link)"
[[ $(call GET /shares/in "$TB" | j ".requests.every(r=>r.mediaIds===undefined)") == true ]] && ok "… the inbox doesn't"
[[ $(call GET /blocks "$TB" | j ".blocked.length===1 && o.blocked[0].id==='$IA' && !!o.blocked[0].name") == true ]] && ok "B's blocked list shows A by name"
call DELETE "/blocks/$IA" "$TB" >/dev/null && ok "B unblocks A"
[[ $(call GET /blocks "$TB" | j .blocked.length) == 0 ]] && ok "blocked list is empty again"
[[ $(call GET /shared "$TB" | j .items.length) == 2 ]] && ok "accepted items stay through decline/block"

# --- albums, shared albums, duplicate check (docs/design/organise-and-share.md) ---
R=$(call POST /albums "$TA" -d "{\"name\":\"  Goa   trip \",\"mediaIds\":[\"$ID1\",\"$ID2\"]}"); AL=$(echo "$R" | j .album.id)
[[ $(echo "$R" | j .album.name) == "Goa trip" && $(echo "$R" | j .album.count) == 2 ]] && ok "album created with 2 items ($AL)"
[[ $(call GET /albums "$TA" | j '.albums[0].name') == "Goa trip" ]] && ok "album listed"
[[ $(call GET "/albums/$AL" "$TA" | j .items.length) == 2 ]] && ok "album shows its items"
[[ $(call POST /albums "$TA" -d '{"name":""}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "album needs a name"
R=$(call POST /shares "$TA" -d "{\"albumId\":\"$AL\",\"to\":[\"$IB\"]}"); SA=$(echo "$R" | j '.requests[0].shareId')
[[ $(echo "$R" | j '.requests[0].status') == pending ]] && ok "album share is a request"
[[ $(call GET "/shares/in/$SA" "$TB" | j .album.name) == "Goa trip" ]] && ok "B sees which album is offered"
[[ $(call GET /albums "$TB" | j .shared.length) == 0 ]] && ok "no shared album before accepting"
call POST "/shares/in/$SA/accept" "$TB" >/dev/null
[[ $(call GET /albums "$TB" | j '.shared[0].name') == "Goa trip" ]] && ok "B has the shared album"
[[ $(call GET /shared "$TB" | j ".items.filter(i=>i.albumId==='$AL').length") == 2 ]] && ok "its 2 items are in B's Shared tab"
call POST "/albums/$AL/items" "$TA" -d "{\"remove\":[\"$ID2\"]}" >/dev/null
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$ID2')") == false ]] && ok "removed from the album → B loses that item"
call POST "/albums/$AL/items" "$TA" -d "{\"add\":[\"$ID2\"]}" >/dev/null
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$ID2')") == true ]] && ok "added to the album → B gets it without a new request"
call PUT "/albums/$AL" "$TA" -d '{"name":"Goa 2026"}' >/dev/null
[[ $(call GET /albums "$TB" | j '.shared[0].name') == "Goa 2026" ]] && ok "rename reaches members"
[[ $(call POST "/shares/out/$SA/cancel" "$TA" | j .status) == revoked ]] && ok "A revokes the album from B"
[[ $(call GET /albums "$TB" | j .shared.length) == 0 && $(call GET /shared "$TB" | j .items.length) == 0 ]] && ok "B loses the album and its items"
call DELETE "/albums/$AL" "$TA" >/dev/null
[[ $(call GET /albums "$TA" | j .albums.length) == 0 && $(call GET /media "$TA" | j .items.length) == 2 ]] && ok "deleting an album keeps the photos"
[[ $(call POST /media/check "$TA" -d "{\"md5\":\"$PMD5\",\"size\":300000}" | j .duplicate.id) == "$ID1" ]] && ok "the same file again is recognised as already in Lens"
[[ $(call POST /media/check "$TA" -d '{"md5":"AAAAAAAAAAAAAAAAAAAAAA==","size":300000}' | j .duplicate) == "" ]] && ok "a different file isn't"
# Back to a plain direct share of both items for the tests below.
SR=$(call POST /shares "$TA" -d "{\"mediaIds\":[\"$ID1\",\"$ID2\"],\"to\":[\"$IB\"]}" | j '.requests[0].shareId')
call POST "/shares/in/$SR/accept" "$TB" >/dev/null
[[ $(call GET /shared "$TB" | j .items.length) == 2 ]] && ok "direct share restored"

# --- Places + private location (docs/design/organise-and-share.md step 2) ---
C=$(curl -sS -X POST "$API/devices"); TC=$(echo "$C" | j .token)
# Real names: optional, next to the unique Lens name; never searchable by strangers.
[[ $(call PUT /me "$TA" -d '{"realName":"  Asha   Verma\u0007 "}' | j .realName) == "Asha Verma" ]] && ok "A sets a real name (cleaned)"
[[ $(call GET /me "$TA" | j .realName) == "Asha Verma" ]] && ok "… /me returns it"
[[ $(call GET /contacts "$TB" | j ".contacts.find(c=>c.id==='$IA').realName") == "Asha Verma" ]] && ok "B (shared with A) sees A's real name"
[[ $(call GET "/users?q=$NA" "$TC" | j ".users.find(u=>u.id==='$IA').realName") == "" ]] && ok "a stranger's search shows only the Lens name"
[[ $(call GET "/users/$IA" "$TC" | j .user.realName) == "Asha Verma" ]] && ok "a scanned code shows the real name"
[[ $(call PUT /me "$TB" -d '{"realName":"Asha Verma"}' | j .realName) == "Asha Verma" ]] && ok "two people may have the same real name"
call PUT /me "$TB" -d '{"realName":null}' >/dev/null
[[ $(call PUT /me "$TA" -d '{"realName":""}' | j .realName) == "" && $(call GET /me "$TA" | j .realName) == "" ]] && ok "A clears it"
GPSF="$(dirname "$0")/fixtures/gps.jpg"; GSIZE=$(stat -c %s "$GPSF"); GMD5=$(md5b64 "$GPSF")
IDG="$(node -p "Date.now().toString(36).padStart(8,'0')")-gpsplace"
R=$(call POST /media "$TC" -d "{\"id\":\"$IDG\",\"contentType\":\"image/jpeg\",\"size\":$GSIZE,\"kind\":\"photo\",\"md5\":\"$GMD5\",\"gps\":{\"lat\":30.741,\"lng\":76.7833}}")
curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: image/jpeg' -H "content-md5: $GMD5" --data-binary @"$GPSF" -o /dev/null
R=$(call POST "/media/$IDG/complete" "$TC"); [[ $(echo "$R" | j .media.place.city) == Chandigarh && $(echo "$R" | j .media.hasGps) == true ]] && ok "photo with a position gets its place (Chandigarh)"
[[ $(call GET /places "$TC" | j '.places.find(p=>p.city==="Chandigarh").count') == 1 ]] && ok "Places groups it"
[[ $(call GET "/places/items?key=$(node -p "encodeURIComponent('IN|Chandigarh|Chandigarh')")" "$TC" | j '.items[0].id') == "$IDG" ]] && ok "the place lists the photo"
[[ $(call POST /media/places "$TC" -d "{\"items\":[{\"id\":\"$IDG\",\"lat\":48.8584,\"lng\":2.2945}]}" | j .updated) == 1 ]] && ok "backfill sets a place for a photo"
[[ $(call GET /places "$TC" | j '.places.map(p=>p.city).join()') == Paris ]] && ok "… it moves to Paris"
call POST /media/places "$TC" -d "{\"items\":[{\"id\":\"$IDG\",\"lat\":30.741,\"lng\":76.7833}]}" >/dev/null
SG=$(call POST /shares "$TC" -d "{\"mediaIds\":[\"$IDG\"],\"to\":[\"$IB\"]}" | j '.requests[0].shareId'); call POST "/shares/in/$SG/accept" "$TB" >/dev/null
R=$(call GET /shared "$TB"); [[ $(echo "$R" | j ".items.find(i=>i.id==='$IDG').place") == "" ]] && ok "recipient doesn't get the place"
curl -sS -o "$TMP/shared-gps.jpg" "$(echo "$R" | j ".items.find(i=>i.id==='$IDG').url")"
node -e "const b=require('fs').readFileSync('$TMP/shared-gps.jpg');process.exit(b.includes(Buffer.from([0x1e,0,0,0,1,0,0,0]))||b.length!==$GSIZE?1:0)" && ok "recipient's copy has the GPS wiped (same size)" || fail "recipient copy not GPS-free"
cmp -s "$TMP/shared-gps.jpg" "$GPSF" && fail "recipient got the original with GPS" || true
call POST "/shares/out/$SG/cancel" "$TC" >/dev/null
SG2=$(call POST /shares "$TC" -d "{\"mediaIds\":[\"$IDG\"],\"to\":[\"$IB\"],\"includeLocation\":true}" | j '.requests[0].shareId'); call POST "/shares/in/$SG2/accept" "$TB" >/dev/null
curl -sS -o "$TMP/shared-gps2.jpg" "$(call GET /shared "$TB" | j ".items.find(i=>i.id==='$IDG').url")"
cmp -s "$TMP/shared-gps2.jpg" "$GPSF" && ok "with \"include location\" the recipient gets the original"
call POST "/shares/out/$SG2/cancel" "$TC" >/dev/null
# Videos: the position lives in the moov box (fixtures/gps.mp4: Chandigarh, 3GPP loci); shared without location = zeroed copy.
GVF="$(dirname "$0")/fixtures/gps.mp4"; GVSIZE=$(stat -c %s "$GVF"); GVMD5=$(md5b64 "$GVF")
IDV="$(node -p "Date.now().toString(36).padStart(8,'0')")-gpsvideo"
R=$(call POST /media "$TC" -d "{\"id\":\"$IDV\",\"contentType\":\"video/mp4\",\"size\":$GVSIZE,\"kind\":\"video\",\"md5\":\"$GVMD5\",\"gps\":{\"lat\":30.7333,\"lng\":76.7794}}")
curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: video/mp4' -H "content-md5: $GVMD5" --data-binary @"$GVF" -o /dev/null
R=$(call POST "/media/$IDV/complete" "$TC"); [[ $(echo "$R" | j .media.place.city) == Chandigarh ]] && ok "video with a position gets its place"
SV=$(call POST /shares "$TC" -d "{\"mediaIds\":[\"$IDV\"],\"to\":[\"$IB\"]}" | j '.requests[0].shareId'); call POST "/shares/in/$SV/accept" "$TB" >/dev/null
curl -sS -o "$TMP/shared-gps.mp4" "$(call GET /shared "$TB" | j ".items.find(i=>i.id==='$IDV').url")"
node -e "const b=require('fs').readFileSync('$TMP/shared-gps.mp4');process.exit(b.includes('loci')||b.length!==$GVSIZE||!b.includes('moov')?1:0)" && ok "recipient's video copy has the location zeroed (same size)" || fail "recipient video copy not location-free"
call POST "/shares/out/$SV/cancel" "$TC" >/dev/null
SV2=$(call POST /shares "$TC" -d "{\"mediaIds\":[\"$IDV\"],\"to\":[\"$IB\"],\"includeLocation\":true}" | j '.requests[0].shareId'); call POST "/shares/in/$SV2/accept" "$TB" >/dev/null
curl -sS -o "$TMP/shared-gps2.mp4" "$(call GET /shared "$TB" | j ".items.find(i=>i.id==='$IDV').url")"
cmp -s "$TMP/shared-gps2.mp4" "$GVF" && ok "with \"include location\" the recipient gets the original video"
call POST "/shares/out/$SV2/cancel" "$TC" >/dev/null

# --- Share links (docs/features/share-links.md): people without Lens, by WhatsApp etc. ---
pub() { curl -sS "$API/links/$1"; }
LT=$(call POST /links "$TC" -d "{\"mediaIds\":[\"$IDG\"],\"expires\":\"7d\",\"mode\":\"anyone\"}" | j .link.token)
[[ ${#LT} == 22 ]] && ok "C makes a link for one photo"
[[ $(call POST /links "$TC" -d '{"albumId":"x","mediaIds":["a"]}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "albums can't be shared by link"
[[ $(call POST /links "$TC" -d "{\"mediaIds\":$(node -p "JSON.stringify(Array.from({length:21},(_, i)=>'x'+i))")}" -o /dev/null -w '%{http_code}') == 400 ]] && ok "a link holds at most 20 items"
[[ $(call POST /links "$TC" -d '{"mediaIds":["someone-elses1"]}' -o /dev/null -w '%{http_code}') == 409 ]] && ok "only your own uploaded items"
R=$(pub "$LT"); [[ $(echo "$R" | j .items.length) == 1 && $(echo "$R" | j .link.status) == active && $(echo "$R" | j ".items[0].place") == "" ]] && ok "the web page sees the photo (no place)"
curl -sS -o "$TMP/link-gps.jpg" "$(echo "$R" | j ".items[0].url")"
node -e "const b=require('fs').readFileSync('$TMP/link-gps.jpg');process.exit(b.includes(Buffer.from([0x1e,0,0,0,1,0,0,0]))||b.length!==$GSIZE?1:0)" && ok "… its original has the GPS wiped" || fail "link original not GPS-free"
R=$(call POST "/links/$LT/open" "$TB"); [[ -n $(echo "$R" | j .shareId) ]] && ok "B opens it in Lens"
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$IDG')") == true ]] && ok "… and has it in Shared"
[[ $(call GET /shares/out "$TC" | j ".requests.find(r=>r.viaLink&&r.to.id==='$IB').status") == accepted ]] && ok "C's Sent shows B opened the link"
[[ $(call POST "/links/$LT/open" "$TB" | j .shareId) == $(echo "$R" | j .shareId) ]] && ok "opening again changes nothing"
LO=$(call POST /links "$TC" -d "{\"mediaIds\":[\"$IDV\"],\"expires\":\"1d\",\"mode\":\"one\"}" | j .link.token)
[[ $(pub "$LO" | j .items.length) == 0 && $(pub "$LO" | j .link.mode) == one ]] && ok "a one-person link shows nothing on the web"
call POST "/links/$LO/open" "$TB" >/dev/null
[[ $(call POST "/links/$LO/open" "$TA" -o /dev/null -w '%{http_code}') == 403 ]] && ok "… once opened, nobody else can"
[[ $(pub "$LO" | j .link.status) == used ]] && ok "… and the page says it was opened"
[[ $(call GET /links "$TC" | j ".links.length") == 2 && $(call GET /links "$TC" | j ".links.find(l=>l.token==='$LT').claims[0].id") == "$IB" ]] && ok "C's links list who opened them"
[[ $(call GET /links "$TA" | j ".links.length") == 0 ]] && ok "links are private to their owner"
[[ $(call POST "/links/$LT/revoke" "$TA" -o /dev/null -w '%{http_code}') == 404 ]] && ok "only the owner can turn a link off"
call POST "/links/$LT/revoke" "$TC" >/dev/null
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$IDG')") == false ]] && ok "turning it off ends B's access"
[[ $(pub "$LT" | j .link.status) == revoked && $(pub "$LT" | j .items.length) == 0 ]] && ok "… and the web page shows nothing"
[[ $(call POST "/links/$LT/open" "$TA" -o /dev/null -w '%{http_code}') == 410 ]] && ok "… and nobody can open it any more"
[[ $(curl -sS -o /dev/null -w '%{http_code}' "$API/links/AAAAAAAAAAAAAAAAAAAAAA") == 404 ]] && ok "unknown links: 404"
call POST "/links/$LO/revoke" "$TC" >/dev/null

# --- Nearby on this Wi-Fi (step 3): codes only, names only for people who opted in ---
[[ $(call POST /nearby/code "$TA" | j .code) == "" ]] && ok "not visible: no code to announce"
call PUT /nearby "$TA" -d '{"visible":true}' >/dev/null
NCA=$(call POST /nearby/code "$TA" | j .code); [[ ${#NCA} == 16 ]] && ok "visible: a 16-character code"
[[ $(call POST /nearby/resolve "$TB" -d "{\"codes\":[\"$NCA\",\"AAAAAAAAAAAAAAAA\"]}" | j '.people.map(p=>p.name).join()') == "$NA" ]] && ok "B on the same Wi-Fi sees $NA (a made-up code shows nothing)"
[[ $(call POST /nearby/resolve "$TA" -d "{\"codes\":[\"$NCA\"]}" | j .people.length) == 0 ]] && ok "you don't see yourself"
call PUT /nearby "$TA" -d '{"visible":false}' >/dev/null
[[ $(call POST /nearby/resolve "$TB" -d "{\"codes\":[\"$NCA\"]}" | j .people.length) == 0 ]] && ok "turned off: the old code shows nothing"
call PUT /nearby "$TA" -d '{"visible":true}' >/dev/null; NCA=$(call POST /nearby/code "$TA" | j .code)
call POST "/blocks/$IA" "$TB" >/dev/null
[[ $(call POST /nearby/resolve "$TB" -d "{\"codes\":[\"$NCA\"]}" | j .people.length) == 0 ]] && ok "blocked people don't show as nearby"
call DELETE "/blocks/$IA" "$TB" >/dev/null; call PUT /nearby "$TA" -d '{"visible":false}' >/dev/null

# --- People share suggestions (the server keeps only a switch; faces stay on phones) ---
# A's friends list still has B here (B blocked A earlier, which only removed B's entry for A).
[[ $(call GET /people/suggest "$TB" | j .suggestMe) == false ]] && ok "people suggestions: off by default"
sug() { call GET /contacts "$TA" | j ".contacts.find(c=>c.id==='$IB')?.suggestMe"; }
[[ $(sug) == false ]] && ok "A's friends list: B can't be suggested yet"
call PUT /people/suggest "$TB" -d '{"suggestMe":true}' >/dev/null
[[ $(call GET /people/suggest "$TB" | j .suggestMe) == true && $(sug) == true ]] && ok "B turned it on: A's phone may suggest sharing with B"
call POST "/blocks/$IA" "$TB" >/dev/null
[[ $(sug) == false ]] && ok "B blocked A: B is never suggested to A"
call DELETE "/blocks/$IA" "$TB" >/dev/null
[[ $(sug) == true ]] && ok "unblocked: suggestions come back"
call PUT /people/suggest "$TB" -d '{"suggestMe":false}' >/dev/null
[[ $(sug) == false ]] && ok "B turned it off again"

# --- pairing (web sign-in) ---
CODE=$(call POST /pairing "$TA" | j .code); ok "pairing code $CODE"
W=$(curl -sS -X POST "$API/pairing/claim" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}"); TW=$(echo "$W" | j .token)
[[ $(call GET /media "$TW" | j .items.length) == 2 ]] && ok "web token sees A's media"
[[ $(curl -sS -X POST "$API/pairing/claim" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" -o /dev/null -w '%{http_code}') == 400 ]] && ok "code is single-use"

# --- delete scope, Trash, Archive ---
FN=$(node -p "require('./outputs.json').Lens.MaintenanceFunction")
DAY=86400000
maint() { aws lambda invoke --profile lens --function-name "$FN" --cli-binary-format raw-in-base64-out \
  --payload "{\"now\":$(( $(date +%s%3N) + $1 * DAY )),\"onlyOwner\":\"$IA\"}" "$TMP/maint.json" >/dev/null && cat "$TMP/maint.json"; }
used() { call GET /me "$TA" | j .usedBytes; }
U0=$(used)
[[ $(call DELETE "/media/$ID1" "$TA" | j .code) == shared ]] && ok "shared item asks for a scope"
[[ $(call DELETE "/media/$ID1?scope=me" "$TA" | j .phase) == hidden ]] && ok "deleted only for me"
[[ $(call GET /media "$TA" | j ".items.some(i=>i.id==='$ID1')") == false ]] && ok "hidden from owner"
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$ID1')") == true ]] && ok "recipient keeps it"
[[ $(used) == $(( U0 - 300000 )) ]] && ok "only-for-me releases quota"
[[ $(call DELETE "/media/$ID2?scope=everyone" "$TA" | j .phase) == trash ]] && ok "deleted for everyone → Trash"
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$ID2')") == false ]] && ok "recipient no longer sees it"
[[ $(call GET /trash "$TA" | j ".items.find(i=>i.id==='$ID2').phase") == trash ]] && ok "listed in Trash"
[[ $(used) == $(( U0 - 300000 )) ]] && ok "Trash still counts toward quota"
[[ $(call POST "/media/$ID2/restore" "$TA" | j .phase) == restored ]] && ok "restored from Trash"
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$ID2')") == true ]] && ok "restore brings it back for recipients"
call DELETE "/media/$ID2?scope=everyone" "$TA" >/dev/null
[[ $(maint 29 | j .archived) == 0 ]] && ok "day 29: still in Trash"
[[ $(maint 31 | j .archived) == 1 ]] && ok "day 31: moved to Archive"
[[ $(call GET /trash "$TA" | j ".items.find(i=>i.id==='$ID2').phase") == archive ]] && ok "listed in Archive"
[[ $(call GET /trash "$TA" | j ".items.find(i=>i.id==='$ID2').url") == "" ]] && ok "no original URL while archived"
[[ $(aws s3api get-object-tagging --profile lens --bucket "$BUCKET" --key "m/$IA/$ID2.mov" --query 'TagSet[0].Key' --output text) == lens-archive ]] && ok "original tagged for the archive tier"
[[ $(used) == 0 ]] && ok "archived items don't count toward quota"
call DELETE "/shared/$IA/$ID1" "$TB" >/dev/null
[[ $(call GET /trash "$TA" | j ".items.some(i=>i.id==='$ID1')") == true ]] && ok "last recipient removed only-for-me item → owner's deleted items"
[[ $(maint 1 | j .archived) == 1 ]] && ok "orphaned item goes straight to Archive"
[[ $(call POST "/media/$ID2/restore" "$TA" | j .phase) == restored ]] && ok "recovered from Archive (not yet in the deep tier: instant)"
[[ $(aws s3api get-object-tagging --profile lens --bucket "$BUCKET" --key "m/$IA/$ID2.mov" --query 'length(TagSet)' --output text) == 0 ]] && ok "archive tag removed"
[[ $(used) == $SIZE ]] && ok "recovered item counts again"
[[ $(maint 400 | j .purged) == 1 ]] && ok "after a year in the Archive: purged"
[[ $(call GET /trash "$TA" | j .items.length) == 0 ]] && ok "nothing left in Trash/Archive"
[[ $(vcount "m/$IA/$ID1.") == 0 ]] && ok "purge removed every version"
call DELETE "/media/$ID2?scope=everyone" "$TA" >/dev/null; call DELETE "/media/$ID2/forever" "$TA" >/dev/null
[[ $(used) == 0 && $(call GET /media "$TA" | j .items.length) == 0 ]] && ok "delete forever releases quota"
# --- storage settings ---
S=$(call GET /storage "$TA")
[[ $(echo "$S" | j .lens.quotaBytes) == $((100*1024*1024*1024)) && $(echo "$S" | j .lens.recentBytes) == $((20*1024*1024*1024)) ]] && ok "Lens storage: 100 GB, Recent 20 GB"
[[ $(echo "$S" | j .storages.length) == 0 ]] && ok "no storage connected yet"
[[ $(call PUT /storages/gdrive-test1 "$TA" -d '{"provider":"gdrive","label":"Google Drive","account":"a@example.com","status":"ok","usedBytes":1000,"totalBytes":16106127360}' | j .storage.provider) == gdrive ]] && ok "storage connected"
[[ $(call PUT /storages/gdrive-test1 "$TA" -d '{"provider":"gdrive","status":"low"}' | j .storage.account) == a@example.com ]] && ok "health report keeps account details"
[[ $(call PUT /storages/dropbox-test2 "$TA" -d '{"provider":"dropbox","label":"Dropbox"}' | j .code) == plan-limit ]] && ok "free plan: one storage"
[[ $(call PUT /storages/gdrive-test1 "$TA" -d '{"provider":"nope"}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "unknown provider rejected"
[[ $(call GET /storage "$TA" | j '.storages[0].status') == low ]] && ok "status visible"
call DELETE /storages/gdrive-test1 "$TA" >/dev/null
[[ $(call GET /storage "$TA" | j .storages.length) == 0 ]] && ok "storage disconnected"
[[ $(call POST /provider-requests "$TA" -d '{"provider":"pCloud","note":"e2e"}' -o /dev/null -w '%{http_code}') == 201 ]] && ok "provider request saved"
[[ $(call POST /provider-requests "$TA" -d '{}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "empty request rejected"
# --- originals in the user's own storage ---
call PUT /storages/gdrive-ext1 "$TA" -d '{"provider":"gdrive","label":"Google Drive"}' >/dev/null
IDX="$(node -p "Date.now().toString(36).padStart(8,'0')")-extern1"
U1=$(used)
R=$(call POST /media "$TA" -d "{\"id\":\"$IDX\",\"contentType\":\"image/heic\",\"size\":5000000,\"kind\":\"photo\",\"location\":{\"storageId\":\"gdrive-ext1\",\"provider\":\"gdrive\"}}")
[[ $(echo "$R" | j .mode) == external ]] && ok "upload plan: original goes to their storage"
[[ $(call POST "/media/$IDX/complete" "$TA" -o /dev/null -w '%{http_code}') == 400 ]] && ok "can't complete it as a Lens upload"
R=$(call POST "/media/$IDX/external" "$TA" -d '{"ref":"drive-file-123","checksum":"abc"}')
[[ $(echo "$R" | j .media.originalReady) == true && $(echo "$R" | j .media.location.ref) == drive-file-123 && -z $(echo "$R" | j .media.url) ]] && ok "verified in their storage; no Lens URL"
[[ $(used) == "$U1" ]] && ok "doesn't use Lens storage"
[[ $(call POST /media "$TA" -d "{\"id\":\"${IDX%-*}-unknown1\",\"contentType\":\"image/heic\",\"size\":5000,\"kind\":\"photo\",\"location\":{\"storageId\":\"nope-123\",\"provider\":\"gdrive\"}}" -o /dev/null -w '%{http_code}') == 409 ]] && ok "unknown storage rejected"
IDS="$(node -p "Date.now().toString(36).padStart(8,'0')")-switch1"
call POST /media "$TA" -d "{\"id\":\"$IDS\",\"contentType\":\"image/jpeg\",\"size\":300000,\"kind\":\"photo\",\"location\":{\"storageId\":\"gdrive-ext1\",\"provider\":\"gdrive\"}}" >/dev/null
[[ $(call POST /media "$TA" -d "{\"id\":\"$IDS\",\"contentType\":\"image/jpeg\",\"size\":300000,\"kind\":\"photo\"}" | j .mode) == single ]] && ok "their storage full → same item switches to Lens"
call DELETE "/media/$IDS/forever" "$TA" >/dev/null
[[ $(call DELETE "/media/$IDX?scope=everyone" "$TA" | j .phase) == trash ]] && ok "own-storage item → Trash"
[[ $(maint 31 | j .purged) == 1 ]] && ok "after 30 days: removed (their storage keeps its own trash)"
call DELETE /storages/gdrive-ext1 "$TA" >/dev/null

# --- OAuth relay ---
[[ $(call GET /oauth/providers "$TA" | j .providers.gdrive) =~ ^(true|false)$ ]] && ok "provider setup status"
loc() { curl -sS -D - -o /dev/null "$1" | tr -d '\r' | sed -n 's/^location: //Ip'; }
LOC=$(loc "$API/oauth/callback?error=access_denied")
[[ "$LOC" == lens://oauth?error=access_denied* ]] && ok "cancelled sign-in returns to the app"
LOC=$(loc "$API/oauth/callback?code=x&state=forged.state")
[[ "$LOC" == lens://oauth?error=* ]] && ok "forged state rejected"
[[ $(call POST /oauth/nope/start "$TA" -d '{}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "unknown provider rejected"
# --- accounts: email code sign-in, merge on a second phone, sessions ---
MAIL="user$(date +%s)@e2e.lens.invalid"
C=$(curl -sS -X POST "$API/devices" -H 'content-type: application/json' -d '{"device":"Pixel 8"}'); TC=$(echo "$C" | j .token); IC=$(echo "$C" | j .id)
[[ $(call POST /auth/email/start "$TC" -d "{\"email\":\"$MAIL\"}" | j .sent) == true ]] && ok "sign-in code sent"
[[ $(call POST /auth/email/verify "$TC" -d "{\"email\":\"$MAIL\",\"code\":\"000000\"}" -o /dev/null -w '%{http_code}') == 400 ]] && ok "wrong code rejected"
CODE=$(otp "$MAIL")
R=$(call POST /auth/email/verify "$TC" -d "{\"email\":\"$MAIL\",\"code\":\"$CODE\"}")
[[ $(echo "$R" | j .id) == "$IC" && -z $(echo "$R" | j .token) ]] && ok "first sign-in: this phone's guest identity became the account"
[[ $(call GET /me "$TC" | j .email) == "$MAIL" ]] && ok "account shows the email"
[[ $(call POST /auth/email/verify "$TC" -d "{\"email\":\"$MAIL\",\"code\":\"$CODE\"}" -o /dev/null -w '%{http_code}') == 400 ]] && ok "code works only once"

D=$(curl -sS -X POST "$API/devices" -H 'content-type: application/json' -d '{"device":"Galaxy S24"}'); TD=$(echo "$D" | j .token)
IDM="$(node -p "Date.now().toString(36).padStart(8,'0')")-merge01"
head -c 120000 /dev/urandom > "$TMP/m.jpg"; MM=$(md5b64 "$TMP/m.jpg")
R=$(call POST /media "$TD" -d "{\"id\":\"$IDM\",\"contentType\":\"image/jpeg\",\"size\":120000,\"kind\":\"photo\",\"md5\":\"$MM\"}")
curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: image/jpeg' -H "content-md5: $MM" --data-binary @"$TMP/m.jpg" -o /dev/null
call POST "/media/$IDM/complete" "$TD" >/dev/null
call POST /auth/email/start "$TD" -d "{\"email\":\"$MAIL\"}" >/dev/null
R=$(call POST /auth/email/verify "$TD" -d "{\"email\":\"$MAIL\",\"code\":\"$(otp "$MAIL")\",\"device\":\"Galaxy S24\"}")
TD2=$(echo "$R" | j .token)
[[ $(echo "$R" | j .id) == "$IC" && -n "$TD2" && $(echo "$R" | j .moved) -ge 1 ]] && ok "second phone signed in to the same account; its guest photo moved in"
[[ $(call GET /me "$TD" -o /dev/null -w '%{http_code}') == 401 ]] && ok "second phone's guest session retired"
[[ $(call GET /media "$TD2" | j ".items.some(i=>i.id==='$IDM')") == true ]] && ok "account sees the moved photo"
cmp -s <(curl -sS "$(call GET /media "$TD2" | j ".items.find(i=>i.id==='$IDM').url")") "$TMP/m.jpg" && ok "moved photo still opens (bytes identical)"
[[ $(call GET /me "$TD2" | j .usedBytes) == 120000 ]] && ok "quota moved with it"
S=$(call GET /sessions "$TD2")
[[ $(echo "$S" | j .sessions.length) == 2 && $(echo "$S" | j ".sessions.find(s=>s.current).label") == "Galaxy S24" ]] && ok "sessions list both phones, current marked"
call DELETE /sessions "$TD2" >/dev/null
[[ $(call GET /me "$TC" -o /dev/null -w '%{http_code}') == 401 ]] && ok "log out other devices"
call DELETE /sessions/current "$TD2" >/dev/null
[[ $(call GET /me "$TD2" -o /dev/null -w '%{http_code}') == 401 ]] && ok "log out this device"
E=$(curl -sS -X POST "$API/devices"); TE=$(echo "$E" | j .token)
call POST /auth/email/start "$TE" -d "{\"email\":\"$MAIL\"}" >/dev/null
for i in 1 2 3 4 5; do call POST /auth/email/verify "$TE" -d "{\"email\":\"$MAIL\",\"code\":\"111111\"}" >/dev/null; done
[[ $(call POST /auth/email/verify "$TE" -d "{\"email\":\"$MAIL\",\"code\":\"$(otp "$MAIL")\"}" -o /dev/null -w '%{http_code}') == 429 ]] && ok "too many wrong codes locks that code"
[[ $(call POST /auth/google "$TE" -d '{"code":"x","state":"forged.state","codeVerifier":"y"}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "Google sign-in rejects a forged state"
# --- upload while recording (streaming multipart, header rewritten at the end) ---
IDL="$(node -p "Date.now().toString(36).padStart(8,'0')")-live001"
P8=$((8*1024*1024))
head -c $((4*P8 + 300000)) /dev/urandom > "$TMP/rec.mp4"
R=$(call POST /media "$TA" -d "{\"id\":\"$IDL\",\"contentType\":\"video/mp4\",\"size\":0,\"streaming\":true,\"kind\":\"video\"}")
[[ $(echo "$R" | j .mode) == multipart && $(echo "$R" | j .partSize) == $P8 ]] && ok "recording started: streaming upload, 8 MiB parts"
send_part() { local n=$1 m url; dd if="$TMP/rec.mp4" bs=$P8 skip=$((n-1)) count=1 status=none > "$TMP/lp"; m=$(md5b64 "$TMP/lp")
  url=$(call POST "/media/$IDL/parts" "$TA" -d "{\"parts\":[{\"n\":$n,\"md5\":\"$m\"}]}" | j ".urls['$n']")
  curl -sS -X PUT "$url" -H "content-md5: $m" --data-binary @"$TMP/lp" -o /dev/null -w '%{http_code}'; }
[[ $(send_part 3) == 200 && $(send_part 4) == 200 ]] && ok "blocks 3-4 sent while recording (header blocks held back)"
printf 'REWRITTEN-HEADER' | dd of="$TMP/rec.mp4" bs=1 seek=40 conv=notrunc status=none
[[ $(call GET "/media/$IDL/parts" "$TA" | j ".parts.find(p=>p.n===3).etag") =~ ^[0-9a-f]{32}$ ]] && ok "server reports part MD5s (for re-checks)"
for n in 1 2 5; do send_part $n >/dev/null; done
R=$(call POST "/media/$IDL/complete" "$TA" -d "{\"size\":$((4*P8 + 300000))}")
[[ $(echo "$R" | j .media.originalReady) == true ]] && ok "recording stopped: completed with final size"
cmp -s <(curl -sS "$(echo "$R" | j .media.url)") "$TMP/rec.mp4" && ok "cloud copy byte-identical to the final file (rewritten header included)"
call DELETE "/media/$IDL/forever" "$TA" >/dev/null
# --- streaming (the full Batch conversion test is tests/stream/run.sh) ---
IDV="$(node -p "Date.now().toString(36).padStart(8,'0')")-short01"
head -c 200000 /dev/urandom > "$TMP/short.mp4"; SM=$(md5b64 "$TMP/short.mp4")
R=$(call POST /media "$TA" -d "{\"id\":\"$IDV\",\"contentType\":\"video/mp4\",\"size\":200000,\"kind\":\"video\",\"duration\":8,\"md5\":\"$SM\"}")
curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: video/mp4' -H "content-md5: $SM" --data-binary @"$TMP/short.mp4" -o /dev/null
call POST "/media/$IDV/complete" "$TA" >/dev/null
[[ $(call POST /stream "$TA" -d "{\"mediaId\":\"$IDV\"}" | j .status) == original ]] && ok "short clip plays the original (no conversion)"
[[ $(call POST /stream "$TB" -d "{\"mediaId\":\"$IDV\",\"ownerId\":\"$IA\"}" -o /dev/null -w '%{http_code}') == 404 ]] && ok "can't stream someone else's video unless it's shared"
call DELETE "/media/$IDV/forever" "$TA" >/dev/null
# --- guest limits + device fingerprint ---
FP=$(openssl rand -hex 32)
G1=$(curl -sS -X POST "$API/devices" -H 'content-type: application/json' -d "{\"fingerprint\":\"$FP\"}"); TG1=$(echo "$G1" | j .token); IG1=$(echo "$G1" | j .id)
[[ $(call GET /me "$TG1" | j .quotaBytes) == $((5*1024*1024*1024)) ]] && ok "guest gets 5 GB"
R=$(call POST /media "$TG1" -d "{\"id\":\"$(node -p "Date.now().toString(36).padStart(8,'0')")-guest01\",\"contentType\":\"video/mp4\",\"size\":$((6*1024*1024*1024)),\"kind\":\"video\"}")
[[ $(echo "$R" | j .code) == guest-quota ]] && ok "guest over 5 GB is told to sign in"
G2=$(curl -sS -X POST "$API/devices" -H 'content-type: application/json' -d "{\"fingerprint\":\"$FP\"}")
[[ $(echo "$G2" | j .id) == "$IG1" && $(echo "$G2" | j .restored) == true ]] && ok "reinstall on the same phone gets the same guest back (no fresh 5 GB)"
MAILG="g$(date +%s%N)@e2e.lens.invalid"
call POST /auth/email/start "$TG1" -d "{\"email\":\"$MAILG\"}" >/dev/null
call POST /auth/email/verify "$TG1" -d "{\"email\":\"$MAILG\",\"code\":\"$(otp "$MAILG")\"}" >/dev/null
G3=$(curl -sS -X POST "$API/devices" -H 'content-type: application/json' -d "{\"fingerprint\":\"$FP\"}")
[[ $(echo "$G3" | j .id) != "$IG1" && -z $(echo "$G3" | j .restored) ]] && ok "after that guest signed in, a reinstall starts a new guest (account needs sign-in)"
# --- disposable email providers are refused ---
for DM in yopmail.com mailinator.com abc.guerrillamail.com; do
  [[ $(call POST /auth/email/start "$TE" -d "{\"email\":\"x$RANDOM@$DM\"}" | j .code) == disposable-email ]] || fail "$DM not refused"
done; ok "temporary email providers refused (yopmail, mailinator, subdomains)"
[[ $(call POST /auth/email/start "$TE" -d "{\"email\":\"ok$(date +%s%N)@e2e.lens.invalid\"}" | j .sent) == true ]] && ok "regular addresses still work"
# --- website sign-in through CloudFront /api (HttpOnly cookie session) ---
SITE="${SITE:-$(node -p "require('./outputs.json').Lens.WebUrl.replace(/\/$/, '')")}"
WAPI="$SITE/api/v1"
JAR="$TMP/jar"
wcall() { local m=$1 p=$2; shift 2; curl -sS -X "$m" "$WAPI$p" -b "$JAR" -c "$JAR" -H 'content-type: application/json' -H 'x-lens-web: 1' "$@"; }
# QR: browser asks, phone (account A) approves, browser's next poll is signed in.
Q=$(wcall POST /login-sessions); QID=$(echo "$Q" | j .id); QSEC=$(echo "$Q" | j .secret)
[[ -n "$QID" && -n "$QSEC" ]] && ok "QR sign-in request created"
[[ $(wcall GET "/login-sessions/$QID" -H "x-login-secret: $QSEC" | j .status) == waiting ]] && ok "browser waits for the phone"
[[ $(call GET "/login-sessions/$QID/info" "$TA" | j .browser) != "" ]] && ok "phone sees which browser asks"
[[ $(wcall GET "/login-sessions/$QID" -H "x-login-secret: wrong" -o /dev/null -w '%{http_code}') == 403 ]] && ok "someone else's secret can't collect it"
call POST "/login-sessions/$QID/approve" "$TA" >/dev/null
R=$(wcall GET "/login-sessions/$QID" -H "x-login-secret: $QSEC")
[[ $(echo "$R" | j .status) == approved && -z $(echo "$R" | j .token) ]] && ok "approved: session in the cookie, no token in the body"
grep -q "__Host-lens" "$JAR" && grep "__Host-lens" "$JAR" | grep -q "#HttpOnly_" && ok "cookie is __Host- and HttpOnly"
[[ $(wcall GET /me | j .email) == "$MAILA" ]] && ok "browser is signed in as the phone's account"
[[ $(wcall GET "/login-sessions/$QID" -H "x-login-secret: $QSEC" -o /dev/null -w '%{http_code}') == 404 ]] && ok "QR can't be used twice"
[[ $(curl -sS -X POST "$WAPI/pairing" -b "$JAR" -H 'content-type: application/json' -o /dev/null -w '%{http_code}') == 403 ]] && ok "cookie request without the site header refused (CSRF guard)"
[[ $(call GET /web-sessions "$TA" | j .sessions.length) -ge 1 ]] && ok "phone lists the signed-in browser"
# Deny.
Q=$(wcall POST /login-sessions); QID=$(echo "$Q" | j .id); QSEC=$(echo "$Q" | j .secret)
call POST "/login-sessions/$QID/deny" "$TA" >/dev/null
[[ $(wcall GET "/login-sessions/$QID" -H "x-login-secret: $QSEC" | j .status) == denied ]] && ok "phone can deny a sign-in"
# Log out.
[[ $(wcall DELETE /web-sessions/current | j .signedOut) == true ]] && ok "browser log out"
[[ $(wcall GET /me -o /dev/null -w '%{http_code}') == 401 ]] && ok "logged-out cookie no longer works"
# Email code on the website: an existing account, and a brand-new one.
JAR="$TMP/jar2"
wcall POST /web/auth/email/start -d "{\"email\":\"$MAILA\"}" >/dev/null
[[ $(wcall POST /web/auth/email/verify -d "{\"email\":\"$MAILA\",\"code\":\"$(otp "$MAILA")\"}" | j .email) == "$MAILA" ]] && ok "web email sign-in finds the existing account"
[[ $(wcall GET /me | j .email) == "$MAILA" ]] && ok "same account as the phone"
JAR="$TMP/jar3"; MAILW="w$(date +%s%N)@e2e.lens.invalid"
wcall POST /web/auth/email/start -d "{\"email\":\"$MAILW\"}" >/dev/null
[[ $(wcall POST /web/auth/email/verify -d "{\"email\":\"$MAILW\",\"code\":\"$(otp "$MAILW")\"}" | j .email) == "$MAILW" ]] && ok "web sign-up creates an account"
[[ $(wcall GET /me | j .quotaBytes) == $((100*1024*1024*1024)) ]] && ok "web account gets 100 GB"
[[ $(wcall POST /web/auth/email/verify -d "{\"email\":\"$MAILW\",\"code\":\"000000\"}" -o /dev/null -w '%{http_code}') == 400 ]] && ok "used code refused"
# --- user referrals: +10 GB per friend who signs in on a new phone ---
GB=$((1024*1024*1024))
newphone() { curl -sS -X POST "$API/devices" -H 'content-type: application/json' -d "{\"fingerprint\":\"$1\"${2:+,$2}}"; }
signin() { local t=$1 m=$2; call POST /auth/email/start "$t" -d "{\"email\":\"$m\"}" >/dev/null
  call POST /auth/email/verify "$t" -d "{\"email\":\"$m\",\"code\":\"$(otp "$m")\"}"; }
quota() { call GET /me "$1" | j .quotaBytes; }
FPR=$(openssl rand -hex 32); RR=$(newphone "$FPR"); TR=$(echo "$RR" | j .token)
[[ $(call GET /referrals "$TR" | j .code) == sign-in ]] && ok "guests can't invite (sign in first)"
signin "$TR" "r$(date +%s%N)@e2e.lens.invalid" >/dev/null
REF=$(call GET /referrals "$TR"); RCODE=$(echo "$REF" | j .code)
[[ -n "$RCODE" && $(echo "$REF" | j .link) == *"/r/$RCODE" && $(call GET /referrals "$TR" | j .code) == "$RCODE" ]] && ok "invite code + link (stable): $RCODE"
JAR="$TMP/jar-ref"
R=$(curl -sS -o /dev/null -c "$JAR" -w '%{http_code} %{redirect_url}' "$SITE/r/$RCODE" -A 'Mozilla/5.0 (X11; Linux)')
[[ $R == "302 "*"invite=$RCODE" ]] && grep -q "__Host-lensref" "$JAR" && ok "invite link counts the click, sets the cookie and redirects"
[[ $(curl -sS -o /dev/null -w '%{redirect_url}' "$SITE/r/ZZZZZZZ") != *invite* ]] && ok "unknown code goes to the home page"
F1=$(newphone "$(openssl rand -hex 32)" "\"ref\":\"lens_ref=$RCODE&utm_source=x\""); TF1=$(echo "$F1" | j .token)
[[ $(call GET /referrals "$TR" | j ".friends[0].state") == joined ]] && ok "friend installed from the invite: listed as joined, no reward yet"
[[ $(quota "$TR") == $((100*GB)) ]] && ok "no storage before the friend signs in"
MAILF1="f$(date +%s%N)@e2e.lens.invalid"; signin "$TF1" "$MAILF1" >/dev/null
[[ $(quota "$TR") == $((110*GB)) ]] && ok "friend signed in on a new phone: inviter +10 GB (110 GB)"
[[ $(call GET /referrals "$TR" | j .earnedBytes) == $((10*GB)) ]] && ok "invite screen shows 10 GB earned"
F2=$(newphone "$(openssl rand -hex 32)" "\"ref\":\"$RCODE\""); signin "$(echo "$F2" | j .token)" "$MAILF1" >/dev/null
[[ $(quota "$TR") == $((110*GB)) ]] && ok "same person on another phone (existing account): no second reward"
FPF3=$(openssl rand -hex 32); F3=$(newphone "$FPF3" "\"ref\":\"$RCODE\""); TF3=$(echo "$F3" | j .token)
signin "$TF3" "f3$(date +%s%N)@e2e.lens.invalid" >/dev/null
F3B=$(newphone "$FPF3" "\"ref\":\"$RCODE\""); signin "$(echo "$F3B" | j .token)" "f3b$(date +%s%N)@e2e.lens.invalid" >/dev/null
[[ $(quota "$TR") == $((120*GB)) ]] && ok "a second friend: 120 GB; a new account on that same phone earns nothing"
F4=$(newphone "$FPR" "\"ref\":\"$RCODE\""); signin "$(echo "$F4" | j .token)" "f4$(date +%s%N)@e2e.lens.invalid" >/dev/null
[[ $(quota "$TR") == $((120*GB)) ]] && ok "self-referral (inviter's own phone) earns nothing"
F5=$(newphone "$(openssl rand -hex 32)" "\"ref\":\"$RCODE\",\"emulator\":true"); signin "$(echo "$F5" | j .token)" "f5$(date +%s%N)@e2e.lens.invalid" >/dev/null
[[ $(quota "$TR") == $((120*GB)) ]] && ok "emulators earn nothing"
F6=$(newphone "$(openssl rand -hex 32)"); TF6=$(echo "$F6" | j .token); signin "$TF6" "f6$(date +%s%N)@e2e.lens.invalid" >/dev/null
[[ $(call POST /referrals/claim "$TF6" -d '{"code":"BADCODE"}' -o /dev/null -w '%{http_code}') == 404 ]] && ok "wrong typed code refused"
[[ $(call POST /referrals/claim "$TF6" -d "{\"code\":\"${RCODE,,}\"}" | j .state) == rewarded && $(quota "$TR") == $((130*GB)) ]] && ok "typed code within 7 days: rewarded (130 GB)"
[[ $(call POST /referrals/claim "$TF6" -d "{\"code\":\"$RCODE\"}" -o /dev/null -w '%{http_code}') == 409 ]] && ok "only one code per person"
[[ $(call POST /referrals/claim "$TR" -d "{\"code\":\"$RCODE\"}" -o /dev/null -w '%{http_code}') =~ ^(400|409)$ ]] && ok "own code refused"
# Website sign-up from the invite link (cookie), reward when they sign in on a phone.
MAILW2="fw$(date +%s%N)@e2e.lens.invalid"
wcall POST /web/auth/email/start -d "{\"email\":\"$MAILW2\"}" >/dev/null
wcall POST /web/auth/email/verify -d "{\"email\":\"$MAILW2\",\"code\":\"$(otp "$MAILW2")\"}" >/dev/null
[[ $(call GET /referrals "$TR" | j ".friends.length") == 7 && $(quota "$TR") == $((130*GB)) ]] && ok "web sign-up from the invite link is attributed; no reward without a phone"
F7=$(newphone "$(openssl rand -hex 32)"); signin "$(echo "$F7" | j .token)" "$MAILW2" >/dev/null
[[ $(quota "$TR") == $((140*GB)) ]] && ok "…and rewarded when that account signs in on a phone (140 GB)"
[[ $(call GET /referrals "$TR" | j ".friends.filter(f=>f.state==='rewarded').length") == 4 ]] && ok "friends list: 4 rewarded"
IR=$(echo "$RR" | j .id)
[[ $(aws dynamodb query --profile lens --table-name Lens --key-condition-expression 'pk = :p AND begins_with(sk, :s)' \
  --expression-attribute-values "{\":p\":{\"S\":\"D#$IR\"},\":s\":{\"S\":\"BN#\"}}" --query Count --output text) == 4 ]] && ok "bonus ledger has 4 grants"
# --- affiliate program: 50% of net, 30-day hold, payouts with TDS ---
paise() { aws lambda invoke --profile lens --function-name "$FN" --cli-binary-format raw-in-base64-out --payload "$1" "$TMP/p.json" >/dev/null && j .status < "$TMP/p.json"; }
PA=$(newphone "$(openssl rand -hex 32)"); TP=$(echo "$PA" | j .token); IP=$(echo "$PA" | j .id)
[[ $(call POST /affiliates/apply "$TP" -d '{"name":"X","channels":"y","agree":true}' -o /dev/null -w '%{http_code}') == 403 ]] && ok "guests can't apply"
signin "$TP" "p$(date +%s%N)@e2e.lens.invalid" >/dev/null
[[ $(call POST /affiliates/apply "$TP" -d '{"name":"E2E Creator","channels":"youtube.com/@e2e","agree":true,"pan":"BAD"}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "invalid PAN refused"
[[ $(call POST /affiliates/apply "$TP" -d '{"name":"E2E Creator","channels":"youtube.com/@e2e","agree":true,"pan":"ABCDE1234F","upi":"e2e.creator@okaxis"}' | j .status) == applied ]] && ok "affiliate application"
[[ $(call GET /affiliates/me "$TP" | j .panMasked) == "••••••234F" ]] && ok "PAN stored encrypted, shown masked"
[[ $(call POST /affiliates/links "$TP" -d '{}' -o /dev/null -w '%{http_code}') == 403 ]] && ok "no links before approval"
[[ $(call GET /admin/affiliates "$TA" -o /dev/null -w '%{http_code}') == 404 ]] && ok "admin API hidden from normal accounts"
# Admin actions go through the Lens Console API (own sign-in): a test team member with a
# console session made directly in the table (Google + authenticator can't be scripted).
CONSOLE="${CONSOLE:-https://console.lens.instagrowapp.com}/api"
CADM="adm$(date +%s%N)@e2e.lens.invalid"; CTOK=$(openssl rand -hex 32); CHASH=$(printf %s "$CTOK" | sha256sum | cut -d' ' -f1); NOWMS=$(date +%s%3N)
ddbput() { aws dynamodb put-item --profile lens --region ap-south-1 --table-name Lens --item "$1" >/dev/null; }
ddbdel() { aws dynamodb delete-item --profile lens --region ap-south-1 --table-name Lens --key "$1" >/dev/null; }
ddbput "{\"pk\":{\"S\":\"ADMIN#$CADM\"},\"sk\":{\"S\":\"ROLE\"},\"role\":{\"S\":\"admin\"}}"
ddbput "{\"pk\":{\"S\":\"CSESS#$CHASH\"},\"sk\":{\"S\":\"S\"},\"stage\":{\"S\":\"full\"},\"email\":{\"S\":\"$CADM\"},\"createdAt\":{\"N\":\"$NOWMS\"},\"lastSeen\":{\"N\":\"$NOWMS\"},\"ttl\":{\"N\":\"$(( NOWMS / 1000 + 7200 ))\"}}"
trap 'rm -rf "$TMP"; ddbdel "{\"pk\":{\"S\":\"ADMIN#$CADM\"},\"sk\":{\"S\":\"ROLE\"}}"; ddbdel "{\"pk\":{\"S\":\"CSESS#$CHASH\"},\"sk\":{\"S\":\"S\"}}"' EXIT
capi() { local m=$1 p=$2; shift 2; if [[ $m == GET ]]; then curl -sS "$CONSOLE$p" -H "cookie: __Host-lc=$CTOK" "$@"; else curl -sS -X "$m" "$CONSOLE$p" -H "cookie: __Host-lc=$CTOK" -H 'x-console: 1' -H "origin: ${CONSOLE%/api}" -H 'content-type: application/json' "$@"; fi; }
[[ $(capi GET /me | j .role) == admin ]] && ok "console session for a test admin"
[[ $(curl -sS "$CONSOLE/me" -H "authorization: Bearer $TA" -o /dev/null -w '%{http_code}') == 401 ]] && ok "a Lens app token can't use the console"
[[ $(capi GET "/affiliates?status=applied" | j ".affiliates.some(a=>a.id==='$IP')") == true ]] && ok "admin sees the application"
[[ $(capi POST "/affiliates/$IP" -d '{"action":"approve"}' | j .status) == approved ]] && ok "admin approves"
ACODE=$(call GET /affiliates/me "$TP" | j ".links[0].code")
[[ -n "$ACODE" ]] && ok "approved partner gets a first link: $ACODE"
[[ $(call POST /affiliates/links "$TP" -d '{"campaign":"instagram"}' | j .campaign) == instagram ]] && ok "extra campaign link"
[[ $(curl -sS -o /dev/null -w '%{http_code}' "$SITE/go/$ACODE" -A 'Mozilla/5.0') == 302 ]] && ok "affiliate link redirects"
U=$(newphone "$(openssl rand -hex 32)" "\"ref\":\"lens_aff=$ACODE\""); IU=$(echo "$U" | j .id); signin "$(echo "$U" | j .token)" "u$(date +%s%N)@e2e.lens.invalid" >/dev/null
O1="e2e-$(date +%s%N)-1"; O2="e2e-$(date +%s%N)-2"; O3="e2e-$(date +%s%N)-3"
[[ $(paise "{\"purchase\":{\"orderId\":\"$O1\",\"userId\":\"$IU\",\"grossPaise\":9900,\"taxPaise\":1510,\"feePaise\":1259}}") == pending ]] && ok "₹99 purchase: commission pending"
[[ $(paise "{\"purchase\":{\"orderId\":\"$O1\",\"userId\":\"$IU\",\"grossPaise\":9900,\"taxPaise\":1510,\"feePaise\":1259}}") == duplicate ]] && ok "same order twice: counted once"
[[ $(call GET /affiliates/me "$TP" | j .pendingPaise) == 3565 ]] && ok "50% of net ₹71.31 = ₹35.65 pending"
[[ $(call GET /affiliates/me "$TP" | j ".links.find(l=>l.code==='$ACODE').payers") == 1 ]] && ok "funnel: 1 paying user"
paise "{\"purchase\":{\"orderId\":\"$O2\",\"userId\":\"$IU\",\"grossPaise\":9900,\"taxPaise\":1510,\"feePaise\":1259}}" >/dev/null
[[ $(paise "{\"refund\":{\"orderId\":\"$O2\"}}") == reversed && $(call GET /affiliates/me "$TP" | j .pendingPaise) == 3565 ]] && ok "refund during the hold reverses the commission"
paise "{\"purchase\":{\"orderId\":\"$O3\",\"userId\":\"$IU\",\"grossPaise\":354000,\"taxPaise\":54000,\"feePaise\":45000}}" >/dev/null
[[ $(paise "{\"approveCommissions\":{\"now\":$(( $(date +%s%3N) + 29 * DAY )),\"onlyAffiliate\":\"$IP\"}}") == "" && $(call GET /affiliates/me "$TP" | j .approvedPaise) == 0 ]] && ok "still on hold after 29 days"
aws lambda invoke --profile lens --function-name "$FN" --cli-binary-format raw-in-base64-out --payload "{\"approveCommissions\":{\"now\":$(( $(date +%s%3N) + 31 * DAY )),\"onlyAffiliate\":\"$IP\"}}" "$TMP/p.json" >/dev/null
[[ $(j .approved < "$TMP/p.json") == 2 && $(call GET /affiliates/me "$TP" | j .approvedPaise) == 131065 ]] && ok "approved after 30 days: ₹1,310.65"
MONTH="2099-$(printf %02d $(( RANDOM % 12 + 1 )))"
R=$(capi POST /payouts/run -d "{\"month\":\"$MONTH\",\"affiliateId\":\"$IP\"}")
[[ $(echo "$R" | j ".payouts[0].grossPaise") == 131065 && $(echo "$R" | j ".payouts[0].tdsPaise") == 0 ]] && ok "monthly payout statement (under the TDS threshold: no TDS)"
[[ $(capi POST /payouts/run -d "{\"month\":\"$MONTH\",\"affiliateId\":\"$IP\"}" | j .payouts.length) == 0 ]] && ok "payout run is idempotent"
S=$(capi GET "/payouts?month=$MONTH")
[[ $(echo "$S" | j ".payouts.find(p=>p.affiliateId==='$IP').upi") == e2e.creator@okaxis ]] && ok "payout sheet decrypts the UPI ID for the transfer"
[[ $(capi POST "/payouts/$IP/$MONTH/paid" -d '{"reference":"UPI-E2E-1"}' | j .status) == paid ]] && ok "marked paid" || fail "mark paid"
[[ $(call GET /affiliates/me "$TP" | j .paidPaise) == 131065 && $(call GET /affiliates/me "$TP" | j ".payouts[0].status") == paid ]] && ok "partner sees the payout" || fail "partner payout view"
[[ $(paise "{\"refund\":{\"orderId\":\"$O3\"}}") == reversed && $(call GET /affiliates/me "$TP" | j .approvedPaise) == -127500 ]] && ok "refund after payout: clawed back from the next payout"
[[ $(capi POST "/affiliates/$IP" -d '{"action":"suspend","note":"e2e"}' | j .status) == suspended ]] && ok "admin suspends"
[[ $(curl -sS -o /dev/null -w '%{redirect_url}' "$SITE/go/$ACODE") != *via=* ]] && ok "suspended partner's links stop attributing"
[[ $(capi GET "/audit?entity=affiliate:$IP" | j .events.length) -ge 8 ]] && ok "audit trail recorded"
AUDIT=$(node -p "require('./outputs.json').Lens.AuditBucketName")
[[ $(aws s3api list-objects-v2 --profile lens --bucket "$AUDIT" --prefix "audit/$(date -u +%F)/affiliate:$IP/" --query 'length(Contents)' --output text) -ge 8 ]] && ok "audit events locked in S3 (Object Lock)"
# --- in-app feedback (Settings → Feedback): stored first, emailed after ---
R=$(call POST /feedback "$TA" -d '{"kind":"review","rating":5,"message":"[e2e] Love it","includeDevice":true,"device":{"model":"E2E phone","os":"android","osVersion":"16","build":"dev-0","secret":"dropped"}}')
FREF=$(echo "$R" | j .reference)
[[ $(echo "$R" | j .received) == true && $FREF == F-* ]] && ok "review stored ($FREF)"
[[ $(call POST /feedback "$TA" -d '{"kind":"review","message":"no stars"}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "a review needs a star rating"
[[ $(call POST /feedback "$TA" -d '{"kind":"review","rating":9}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "rating must be 1–5"
[[ $(call POST /feedback "$TA" -d '{"kind":"issue","message":"short"}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "a problem report needs a few words"
[[ $(call POST /feedback "$TA" -d '{"kind":"idea","message":"[e2e] please add a timer","email":"not-an-email"}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "a bad reply email is refused"
R=$(call POST /feedback "$TA" -d '{"kind":"issue","message":"[e2e] The camera froze once","email":"reply@e2e.lens.invalid","includeDevice":false,"device":{"model":"should not be kept"}}')
FREF2=$(echo "$R" | j .reference)
[[ $(call POST /feedback "$TA" -d '{"kind":"other","message":"[e2e] bot text here","website":"http://spam"}' | j .received) == true ]] && ok "feedback honeypot: bots get a fake success"
FB=$(capi GET "/feedback")
[[ $(echo "$FB" | j ".feedback.find(f=>f.reference==='$FREF')?.rating") == 5 && $(echo "$FB" | j ".feedback.find(f=>f.reference==='$FREF')?.device.model") == "E2E phone" ]] && ok "admin sees the rating and the shared device"
[[ $(echo "$FB" | j ".feedback.find(f=>f.reference==='$FREF')?.device.secret") == "" ]] && ok "only known device fields are kept"
[[ $(echo "$FB" | j ".feedback.find(f=>f.reference==='$FREF2')?.device") == "" && $(echo "$FB" | j ".feedback.find(f=>f.reference==='$FREF2')?.email") == reply@e2e.lens.invalid ]] && ok "no device details without consent; reply email kept"
[[ $(echo "$FB" | j ".feedback.some(f=>f.message.includes('bot text'))") == false ]] && ok "the bot's feedback isn't stored"
FID=$(echo "$FB" | j ".feedback.find(f=>f.reference==='$FREF')?.id")
[[ $(capi POST "/feedback/$(node -p "encodeURIComponent('$FID')")/done" | j .status) == done ]] && ok "feedback marked done"
[[ $(call GET "/admin/feedback" "$TA" -o /dev/null -w '%{http_code}') == 404 ]] && ok "feedback list hidden from normal accounts"
R=$(call POST /feedback "$TA" -d '{"kind":"review","rating":2,"source":"prompt","message":"[e2e] from the rating card"}'); FREF3=$(echo "$R" | j .reference)
[[ $(capi GET "/feedback" | j ".feedback.find(f=>f.reference==='$FREF3')?.source") == prompt ]] && ok "rating-card answers are tagged with their source"
[[ $(capi GET "/feedback" | j ".feedback.find(f=>f.reference==='$FREF2')?.source") == settings ]] && ok "Settings feedback is tagged settings"
# Screenshots attached to feedback: own uploads only, shown only in the console (and audited).
printf '\xff\xd8\xff\xe0e2e-screenshot' > "$TMP/shot.jpg"; SHOTSIZE=$(stat -c %s "$TMP/shot.jpg")
SLOT=$(call POST /feedback/attachments "$TA" -d "{\"contentType\":\"image/jpeg\",\"size\":$SHOTSIZE}")
SKEY=$(echo "$SLOT" | j .key); SURL=$(echo "$SLOT" | j .url)
[[ $SKEY == f/$IA/* ]] && ok "screenshot upload slot under the account's own folder"
[[ $(curl -sS -X PUT "$SURL" -H 'content-type: image/jpeg' --data-binary @"$TMP/shot.jpg" -o /dev/null -w '%{http_code}') == 200 ]] && ok "screenshot uploaded"
[[ $(call POST /feedback/attachments "$TA" -d '{"contentType":"image/gif","size":10}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "only JPEG/PNG/WebP screenshots"
[[ $(call POST /feedback/attachments "$TA" -d '{"contentType":"image/jpeg","size":9999999}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "screenshots over 4 MB refused"
[[ $(call POST /feedback "$TB" -d "{\"kind\":\"issue\",\"message\":\"[e2e] someone else's screenshot\",\"attachments\":[\"$SKEY\"]}" -o /dev/null -w '%{http_code}') == 400 ]] && ok "can't attach another account's screenshot"
R=$(call POST /feedback "$TA" -d "{\"kind\":\"issue\",\"message\":\"[e2e] with a screenshot\",\"attachments\":[\"$SKEY\"]}"); FREF4=$(echo "$R" | j .reference)
FID4=$(capi GET "/feedback" | j ".feedback.find(f=>f.reference==='$FREF4')?.id")
[[ $(capi GET "/feedback" | j ".feedback.find(f=>f.reference==='$FREF4')?.attachments") == 1 ]] && ok "console lists the screenshot count"
[[ $(capi GET "/feedback/$(node -p "encodeURIComponent('$FID4')")/files/0" -o "$TMP/got.jpg" -w '%{content_type}') == image/jpeg ]] && cmp -s "$TMP/shot.jpg" "$TMP/got.jpg" && ok "console opens the screenshot (same bytes)"
[[ $(capi GET "/feedback/$(node -p "encodeURIComponent('$FID4')")/files/1" -o /dev/null -w '%{http_code}') == 404 ]] && ok "no screenshot beyond what was attached"
[[ $(capi GET "/activity" | j ".events.some(e=>e.action==='feedback.screenshot.viewed'&&e.entity==='feedback:$FID4')") == true ]] && ok "opening a screenshot is in the activity log"
# --- contact form (stored + emailed to the team) ---
R=$(curl -sS -X POST "$WAPI/contact" -H 'content-type: application/json' -d "{\"name\":\"E2E\",\"email\":\"c$(date +%s%N)@e2e.lens.invalid\",\"topic\":\"support\",\"message\":\"Automated test message, please ignore.\"}")
CREF=$(echo "$R" | j .reference)
[[ $(echo "$R" | j .received) == true && $CREF == L-* ]] && ok "contact form message received ($CREF)"
[[ $(curl -sS -X POST "$WAPI/contact" -H 'content-type: application/json' -d '{"name":"x","email":"bad","message":"hello there friend"}' -o /dev/null -w '%{http_code}') == 400 ]] && ok "contact form needs a valid email"
[[ $(curl -sS -X POST "$WAPI/contact" -H 'content-type: application/json' -d '{"name":"bot","email":"b@x.com","message":"spam spam spam","website":"http://spam"}' | j .received) == true ]] && ok "honeypot: bots get a fake success"
CM=$(capi GET "/inbox" | j ".messages.find(m=>m.reference==='$CREF')?.id")
[[ -n "$CM" && $(capi GET "/inbox" | j ".messages.some(m=>m.email==='b@x.com')") == false ]] && ok "admin inbox shows the message (not the bot's)"
[[ $(capi POST "/inbox/$(node -p "encodeURIComponent('$CM')")/done" | j .status) == done ]] && ok "message marked done"
[[ $(call GET "/admin/contact" "$TA" -o /dev/null -w '%{http_code}') == 404 ]] && ok "inbox hidden from normal accounts"
# --- delete account (Play requirement): everything goes, the email can start fresh ---
D=$(curl -sS -X POST "$API/devices"); TD=$(echo "$D" | j .token); ID_D=$(echo "$D" | j .id)
MAILD="d$(date +%s%N)@e2e.lens.invalid"
call POST /auth/email/start "$TD" -d "{\"email\":\"$MAILD\"}" >/dev/null
call POST /auth/email/verify "$TD" -d "{\"email\":\"$MAILD\",\"code\":\"$(otp "$MAILD")\"}" >/dev/null
IDD="$(node -p "Date.now().toString(36).padStart(8,'0')")-delacct"
head -c 200000 /dev/urandom > "$TMP/del.jpg"; DMD5=$(md5b64 "$TMP/del.jpg")
R=$(call POST /media "$TD" -d "{\"id\":\"$IDD\",\"contentType\":\"image/jpeg\",\"size\":200000,\"kind\":\"photo\",\"md5\":\"$DMD5\"}")
curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: image/jpeg' -H "content-md5: $DMD5" --data-binary @"$TMP/del.jpg" -o /dev/null
call POST "/media/$IDD/complete" "$TD" >/dev/null
SD=$(call POST /shares "$TD" -d "{\"mediaIds\":[\"$IDD\"],\"to\":[\"$IB\"]}" | j '.requests[0].shareId')
call POST "/shares/in/$SD/accept" "$TB" >/dev/null
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$IDD')") == true ]] && ok "account to delete has a photo shared with B"
# It also uploaded a Quality Lab set (Settings → Camera info): that must go with the account.
LABF="$TMP/lab.jpg"; head -c 1000 /dev/urandom > "$LABF"; LMD5=$(md5b64 "$LABF")
R=$(call POST /lab/sets "$TD" -d "{\"files\":[{\"name\":\"single.jpg\",\"bytes\":1000,\"md5\":\"$LMD5\"}],\"meta\":{\"e2e\":true}}")
LSET=$(echo "$R" | j .setId)
curl -sS -X PUT "$(echo "$R" | j '.urls["single.jpg"]')" -H 'content-type: image/jpeg' -H "content-md5: $LMD5" --data-binary @"$LABF" -o /dev/null
[[ -n "$LSET" && $(vcount "lab/sets/$LSET/") -ge 2 ]] && ok "account to delete has a Quality Lab set ($LSET)"
[[ $(call POST /feedback "$TD" -d '{"kind":"other","message":"[e2e] feedback before deletion"}' | j .received) == true ]] && ok "account to delete sent feedback"
[[ $(call DELETE /account "$TD" -o /dev/null -w '%{http_code}') == 400 ]] && ok "deletion needs an explicit confirmation"
[[ $(call DELETE /account "$TD" -d '{"confirm":"DELETE"}' -o /dev/null -w '%{http_code}') == 202 ]] && ok "account deletion accepted"
[[ $(call GET /me "$TD" -o /dev/null -w '%{http_code}') == 401 ]] && ok "its sessions stop working at once"
for _ in $(seq 1 30); do
  GONE=$(aws dynamodb get-item --profile lens --table-name Lens --key "{\"pk\":{\"S\":\"D#$ID_D\"},\"sk\":{\"S\":\"PROFILE\"}}" --query Item.pk.S --output text)
  [[ "$GONE" == None ]] && break; sleep 2
done
[[ "$GONE" == None ]] && ok "account removed in the background" || fail "account still there"
[[ $(vcount "m/$ID_D/") == 0 && $(vcount "d/$ID_D/") == 0 && $(vcount "r/$ID_D/") == 0 ]] && ok "every stored file and version deleted"
[[ $(vcount "lab/sets/$LSET/") == 0 ]] && ok "its Quality Lab set deleted too"
[[ $(capi GET "/feedback" | j ".feedback.some(f=>f.message==='[e2e] feedback before deletion')") == false ]] && ok "its feedback deleted too"
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$IDD')") == false ]] && ok "friends lose access to what it shared"
N=$(curl -sS -X POST "$API/devices"); TN=$(echo "$N" | j .token)
call POST /auth/email/start "$TN" -d "{\"email\":\"$MAILD\"}" >/dev/null
R=$(call POST /auth/email/verify "$TN" -d "{\"email\":\"$MAILD\",\"code\":\"$(otp "$MAILD")\"}")
[[ $(echo "$R" | j .id) != "$ID_D" && $(echo "$R" | j .moved) == 0 ]] && ok "the same email starts a fresh, empty account"

# --- event albums: link/QR join, everyone adds (docs/design/switch-features.md §3) ---
up() { local t=$1 id=$2 m r
  head -c 200000 /dev/urandom > "$TMP/ev.jpg"; m=$(md5b64 "$TMP/ev.jpg")
  r=$(call POST /media "$t" -d "{\"id\":\"$id\",\"contentType\":\"image/jpeg\",\"size\":200000,\"kind\":\"photo\",\"md5\":\"$m\"}")
  curl -sS -X PUT "$(echo "$r" | j .url)" -H 'content-type: image/jpeg' -H "content-md5: $m" --data-binary @"$TMP/ev.jpg" -o /dev/null
  call POST "/media/$id/complete" "$t" >/dev/null; }
E=$(curl -sS -X POST "$API/devices"); TE=$(echo "$E" | j .token); IE=$(echo "$E" | j .id)
F=$(curl -sS -X POST "$API/devices"); TF=$(echo "$F" | j .token)
EA1="$(node -p "Date.now().toString(36).padStart(8,'0')")-eva1"; up "$TA" "$EA1"
AE=$(call POST /albums "$TA" -d "{\"name\":\"Wedding\",\"mediaIds\":[\"$EA1\"]}" | j .album.id)
R=$(call POST "/albums/$AE/event" "$TA" -d '{"on":true}'); CODE=$(echo "$R" | j .event.code)
[[ -n "$CODE" && $(echo "$R" | j .event.url) == *"/e/$CODE" ]] && ok "event link made ($CODE)" || fail "no event link"
[[ $(call GET /albums "$TA" | j ".albums.find(a=>a.id==='$AE').event.code") == "$CODE" ]] && ok "the owner's album shows its link"
R=$(curl -sS "$API/events/$CODE")
[[ $(echo "$R" | j .event.name) == Wedding && $(echo "$R" | j .items.length) == 1 && $(echo "$R" | j '.items[0].url') == "" ]] && ok "anyone with the link sees the event (previews only, no originals)"
[[ $(curl -sS "$API/events/nope-nope-nope" -o /dev/null -w '%{http_code}') == 404 ]] && ok "a wrong code finds nothing"
[[ $(call GET "/events/$CODE" "$TE" | j .event.joined) == false ]] && ok "E isn't in yet"
EE1="$(node -p "Date.now().toString(36).padStart(8,'0')")-eve1"; up "$TE" "$EE1"
[[ $(call POST "/events/$CODE/items" "$TE" -d "{\"mediaIds\":[\"$EE1\"]}" -o /dev/null -w '%{http_code}') == 403 ]] && ok "adding before joining is refused"
[[ $(call POST "/events/$CODE/join" "$TE" | j .joined) == true ]] && ok "E joins with the link"
[[ $(call GET /albums "$TE" | j ".shared.find(a=>a.id==='$AE').event") == true ]] && ok "the event is in E's Albums"
[[ $(call GET /shared "$TE" | j ".items.filter(i=>i.albumId==='$AE'&&i.albumOwnerId==='$IA').length") == 1 ]] && ok "E sees the owner's photo"
[[ $(call POST "/shared-albums/$IA/$AE/items" "$TE" -d "{\"mediaIds\":[\"$EE1\"]}" | j .added) == 1 ]] && ok "E adds their own photo"
[[ $(call POST "/shared-albums/$IA/$AE/items" "$TE" -d "{\"mediaIds\":[\"$EA1\"]}" -o /dev/null -w '%{http_code}') == 404 ]] && ok "nobody can add someone else's photo"
[[ $(call GET "/shared-albums/$IA/$AE/mine" "$TE" | j '.mine[0]') == "$EE1" ]] && ok "E's own photos in the album are listed for E"
R=$(call GET "/albums/$AE" "$TA")
[[ $(echo "$R" | j .items.length) == 2 && $(echo "$R" | j ".items.find(i=>i.id==='$EE1').addedBy.id") == "$IE" ]] && ok "the owner sees E's photo, marked as E's"
[[ $(call GET /shared "$TA" | j ".items.some(i=>i.id==='$EE1'&&i.albumId==='$AE')") == true ]] && ok "the owner can open/stream E's photo"
call POST "/events/$CODE/join" "$TF" >/dev/null
[[ $(call GET /shared "$TF" | j ".items.filter(i=>i.albumId==='$AE').length") == 2 ]] && ok "F joins later and sees both people's photos"
[[ $(call DELETE "/shared-albums/$IA/$AE/items/$EE1" "$TF" -o /dev/null -w '%{http_code}') == 403 ]] && ok "F can't remove E's photo"
# A browser without Lens: guest session in the HttpOnly cookie, then join and add like the app.
CJ="$TMP/guest.cookies"
[[ $(curl -sS -X POST "$API/web/guest" -o /dev/null -w '%{http_code}') == 403 ]] && ok "web guest needs the site's own header"
[[ $(curl -sS -X POST "$API/web/guest" -H 'x-lens-web: 1' -c "$CJ" | j .guest) == true ]] && ok "a browser without Lens gets a guest session"
wcall() { local m=$1 p=$2; shift 2; curl -sS -X "$m" "$API$p" -b "$CJ" -H 'x-lens-web: 1' -H 'content-type: application/json' "$@"; }
[[ $(wcall POST "/events/$CODE/join" | j .joined) == true ]] && ok "the browser guest joins the event"
EW1="$(node -p "Date.now().toString(36).padStart(8,'0')")-evw1"
head -c 150000 /dev/urandom > "$TMP/web.jpg"; WM=$(md5b64 "$TMP/web.jpg")
R=$(wcall POST /media -d "{\"id\":\"$EW1\",\"contentType\":\"image/jpeg\",\"size\":150000,\"kind\":\"photo\",\"md5\":\"$WM\"}")
curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: image/jpeg' -H "content-md5: $WM" --data-binary @"$TMP/web.jpg" -o /dev/null
wcall POST "/media/$EW1/complete" >/dev/null
[[ $(wcall POST "/events/$CODE/items" -d "{\"mediaIds\":[\"$EW1\"]}" | j .added) == 1 ]] && ok "the browser guest adds a photo to the event"
[[ $(call GET /shared "$TF" | j ".items.some(i=>i.id==='$EW1')") == true ]] && ok "members see the browser guest's photo"
[[ $(call DELETE "/events/$CODE/members/me" "$TE" | j .left) == "$AE" ]] && ok "E leaves"
[[ $(call GET /shared "$TF" | j ".items.some(i=>i.id==='$EE1')") == false && $(call GET "/albums/$AE" "$TA" | j .items.length) == 2 ]] && ok "E's photo leaves with them (F and the owner lose it)"
[[ $(call GET /albums "$TE" | j ".shared.some(a=>a.id==='$AE')") == false ]] && ok "the event is gone from E's Albums"
call POST "/albums/$AE/event" "$TA" -d '{"on":false}' >/dev/null
[[ $(curl -sS "$API/events/$CODE" -o /dev/null -w '%{http_code}') == 404 ]] && ok "link off: the code stops working"
[[ $(call GET /shared "$TF" | j ".items.filter(i=>i.albumId==='$AE').length") == 2 ]] && ok "people already in keep the album"
call DELETE "/albums/$AE" "$TA" >/dev/null
[[ $(call GET /shared "$TF" | j ".items.some(i=>i.albumId==='$AE')") == false ]] && ok "album deleted: members lose it"

# --- recaps: an event (many photos within hours) is suggested, saved as an album, dismissed (§4) ---
G=$(curl -sS -X POST "$API/devices"); TG=$(echo "$G" | j .token)
head -c 60000 /dev/urandom > "$TMP/rc.jpg"; RM=$(md5b64 "$TMP/rc.jpg")
head -c 9000 /dev/urandom > "$TMP/rct.jpg"; RTM=$(md5b64 "$TMP/rct.jpg")
T0=$(( $(date +%s) * 1000 - 2 * 86400 * 1000 ))
for k in $(seq 1 22); do
  RID="$(node -p "Date.now().toString(36).padStart(8,'0')")-rcap$k"
  R=$(call POST /media "$TG" -d "{\"id\":\"$RID\",\"contentType\":\"image/jpeg\",\"size\":60000,\"kind\":\"photo\",\"md5\":\"$RM\",\"width\":3000,\"height\":4000,\"createdAt\":$(( T0 + k * 600000 )),\"derivatives\":{\"thumb\":{\"md5\":\"$RTM\",\"size\":9000},\"preview\":{\"md5\":\"$RTM\",\"size\":9000}}}")
  for d in thumb preview; do curl -sS -X PUT "$(echo "$R" | j ".derivativeUrls.$d")" -H 'content-type: image/jpeg' -H "content-md5: $RTM" --data-binary @"$TMP/rct.jpg" -o /dev/null; done
  call POST "/media/$RID/previews" "$TG" >/dev/null
  curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: image/jpeg' -H "content-md5: $RM" --data-binary @"$TMP/rc.jpg" -o /dev/null
  call POST "/media/$RID/complete" "$TG" >/dev/null
done
R=$(call GET "/recaps?tz=330" "$TG"); RK=$(echo "$R" | j '.recaps[0].key')
[[ $(echo "$R" | j '.recaps[0].kind') == event && $(echo "$R" | j '.recaps[0].count') == 22 && -n $(echo "$R" | j '.recaps[0].cover.thumbUrl') ]] && ok "22 photos in an afternoon → an event recap with a cover" || fail "no recap: $R"
[[ $(call GET "/recaps/$RK?tz=330" "$TG" | j '.recap.items.length') == 22 ]] && ok "the recap preview lists every photo"
RA=$(call POST "/recaps/$RK/album" "$TG" -d '{}' | j .albumId)
[[ $(call GET "/albums/$RA" "$TG" | j .items.length) == 22 ]] && ok "saved as an album with all 22"
[[ $(call POST "/recaps/$RK/album" "$TG" -d '{}' | j .albumId) == "$RA" ]] && ok "saving twice keeps one album"
call POST "/recaps/$RK/dismiss" "$TG" >/dev/null
[[ $(call GET "/recaps?tz=330" "$TG" | j .recaps.length) == 0 ]] && ok "dismissed recaps aren't suggested again"
echo "ALL PASSED"
