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
ADM=$(newphone "$(openssl rand -hex 32)"); TADM=$(echo "$ADM" | j .token); IADM=$(echo "$ADM" | j .id)
signin "$TADM" "adm$(date +%s%N)@e2e.lens.invalid" >/dev/null
aws dynamodb update-item --profile lens --table-name Lens --key "{\"pk\":{\"S\":\"D#$IADM\"},\"sk\":{\"S\":\"PROFILE\"}}" \
  --update-expression 'SET #a = :t' --expression-attribute-names '{"#a":"admin"}' --expression-attribute-values '{":t":{"BOOL":true}}'
[[ $(call GET "/admin/affiliates?status=applied" "$TADM" | j ".affiliates.some(a=>a.id==='$IP')") == true ]] && ok "admin sees the application"
[[ $(call POST "/admin/affiliates/$IP" "$TADM" -d '{"action":"approve"}' | j .status) == approved ]] && ok "admin approves"
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
R=$(call POST /admin/payouts/run "$TADM" -d "{\"month\":\"$MONTH\",\"affiliateId\":\"$IP\"}")
[[ $(echo "$R" | j ".payouts[0].grossPaise") == 131065 && $(echo "$R" | j ".payouts[0].tdsPaise") == 0 ]] && ok "monthly payout statement (under the TDS threshold: no TDS)"
[[ $(call POST /admin/payouts/run "$TADM" -d "{\"month\":\"$MONTH\",\"affiliateId\":\"$IP\"}" | j .payouts.length) == 0 ]] && ok "payout run is idempotent"
S=$(call GET "/admin/payouts?month=$MONTH" "$TADM")
[[ $(echo "$S" | j ".payouts.find(p=>p.affiliateId==='$IP').upi") == e2e.creator@okaxis ]] && ok "payout sheet decrypts the UPI ID for the transfer"
[[ $(call POST "/admin/payouts/$IP/$MONTH/paid" "$TADM" -d '{"reference":"UPI-E2E-1"}' | j .status) == paid ]] && ok "marked paid"
[[ $(call GET /affiliates/me "$TP" | j .paidPaise) == 131065 && $(call GET /affiliates/me "$TP" | j ".payouts[0].status") == paid ]] && ok "partner sees the payout"
[[ $(paise "{\"refund\":{\"orderId\":\"$O3\"}}") == reversed && $(call GET /affiliates/me "$TP" | j .approvedPaise) == -127500 ]] && ok "refund after payout: clawed back from the next payout"
[[ $(call POST "/admin/affiliates/$IP" "$TADM" -d '{"action":"suspend","note":"e2e"}' | j .status) == suspended ]] && ok "admin suspends"
[[ $(curl -sS -o /dev/null -w '%{redirect_url}' "$SITE/go/$ACODE") != *via=* ]] && ok "suspended partner's links stop attributing"
[[ $(call GET "/admin/audit?entity=affiliate:$IP" "$TADM" | j .events.length) -ge 8 ]] && ok "audit trail recorded"
AUDIT=$(node -p "require('./outputs.json').Lens.AuditBucketName")
[[ $(aws s3api list-objects-v2 --profile lens --bucket "$AUDIT" --prefix "audit/$(date -u +%F)/affiliate:$IP/" --query KeyCount --output text) -ge 8 ]] && ok "audit events locked in S3 (Object Lock)"
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
call POST /shares "$TD" -d "{\"mediaIds\":[\"$IDD\"],\"to\":[\"$IB\"]}" >/dev/null
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$IDD')") == true ]] && ok "account to delete has a photo shared with B"
[[ $(call DELETE /account "$TD" -o /dev/null -w '%{http_code}') == 400 ]] && ok "deletion needs an explicit confirmation"
[[ $(call DELETE /account "$TD" -d '{"confirm":"DELETE"}' -o /dev/null -w '%{http_code}') == 202 ]] && ok "account deletion accepted"
[[ $(call GET /me "$TD" -o /dev/null -w '%{http_code}') == 401 ]] && ok "its sessions stop working at once"
for _ in $(seq 1 30); do
  GONE=$(aws dynamodb get-item --profile lens --table-name Lens --key "{\"pk\":{\"S\":\"D#$ID_D\"},\"sk\":{\"S\":\"PROFILE\"}}" --query Item.pk.S --output text)
  [[ "$GONE" == None ]] && break; sleep 2
done
[[ "$GONE" == None ]] && ok "account removed in the background" || fail "account still there"
[[ $(vcount "m/$ID_D/") == 0 && $(vcount "d/$ID_D/") == 0 ]] && ok "every stored file and version deleted"
[[ $(call GET /shared "$TB" | j ".items.some(i=>i.id==='$IDD')") == false ]] && ok "friends lose access to what it shared"
N=$(curl -sS -X POST "$API/devices"); TN=$(echo "$N" | j .token)
call POST /auth/email/start "$TN" -d "{\"email\":\"$MAILD\"}" >/dev/null
R=$(call POST /auth/email/verify "$TN" -d "{\"email\":\"$MAILD\",\"code\":\"$(otp "$MAILD")\"}")
[[ $(echo "$R" | j .id) != "$ID_D" && $(echo "$R" | j .moved) == 0 ]] && ok "the same email starts a fresh, empty account"
echo "ALL PASSED"
