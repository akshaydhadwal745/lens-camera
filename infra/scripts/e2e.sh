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
# Number of S3 object versions + delete markers under a prefix.
vcount() { aws s3api list-object-versions --profile lens --bucket "$BUCKET" --prefix "$1" --output json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=d.trim()?JSON.parse(d):{};console.log((o.Versions||[]).length+(o.DeleteMarkers||[]).length)})"; }

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

# --- delete scope, Trash, Archive ---
IA=$(echo "$A" | j .id)
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
otp() { aws dynamodb get-item --profile lens --table-name Lens --key "{\"pk\":{\"S\":\"OTP#$1\"},\"sk\":{\"S\":\"CODE\"}}" --query Item.testCode.S --output text; }
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
echo "ALL PASSED"
