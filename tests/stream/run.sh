#!/usr/bin/env bash
# End-to-end streaming test against the deployed stack: upload a 65 s video,
# request streaming, wait for the Batch (Fargate Spot) transcode, then play the
# HLS through the signed CloudFront link. Takes a few minutes. Needs docker
# (to make the test video) and the `lens` AWS profile.
set -euo pipefail
cd "$(dirname "$0")/../../infra"
API="$(node -p "require('./outputs.json').Lens.ApiUrl.replace(/\/$/, '')")/v1"
BUCKET=$(node -p "require('./outputs.json').Lens.MediaBucket")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(eval('o'+process.argv[1])??'')})" "$1"; }
call() { local m=$1 p=$2 t=$3; shift 3; curl -sS -X "$m" "$API$p" -H "authorization: Bearer $t" -H 'content-type: application/json' "$@"; }
ok() { echo "✔ $*"; }
fail() { echo "✘ $*"; exit 1; }

T=$(curl -sS -X POST "$API/devices" | j .token)
docker run --rm -v "$TMP":/data --entrypoint ffmpeg lens-transcoder -hide_banner -loglevel error -y \
  -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 -t 65 \
  -c:v libx264 -preset ultrafast -crf 38 -pix_fmt yuv420p -c:a aac -b:a 64k -shortest /data/v.mp4
SIZE=$(stat -c %s "$TMP/v.mp4"); MD5=$(openssl dgst -md5 -binary "$TMP/v.mp4" | base64)
ID="$(node -p "Date.now().toString(36).padStart(8,'0')")-stream1"
R=$(call POST /media "$T" -d "{\"id\":\"$ID\",\"contentType\":\"video/mp4\",\"size\":$SIZE,\"kind\":\"video\",\"duration\":65,\"md5\":\"$MD5\"}")
curl -sS -X PUT "$(echo "$R" | j .url)" -H 'content-type: video/mp4' -H "content-md5: $MD5" --data-binary @"$TMP/v.mp4" -o /dev/null
call POST "/media/$ID/complete" "$T" >/dev/null
ok "uploaded a 65 s video ($((SIZE/1024)) KB)"

[[ $(call POST /stream "$T" -d "{\"mediaId\":\"$ID\"}" | j .status) == preparing ]] && ok "first play: conversion started (original plays meanwhile)"
START=$(date +%s); URL=""
for i in $(seq 1 60); do
  R=$(call POST /stream "$T" -d "{\"mediaId\":\"$ID\"}")
  if [[ $(echo "$R" | j .status) == ready ]]; then URL=$(echo "$R" | j .url); break; fi
  sleep 15
done
[[ -n "$URL" ]] && ok "converted on AWS Batch (Fargate Spot) in $(( $(date +%s) - START ))s" || fail "not ready after 15 min"

MASTER=$(curl -sS "$URL"); echo "$MASTER" | grep -q '#EXT-X-STREAM-INF' && ok "master playlist served via CloudFront (signed link)"
echo "$MASTER" | grep -o 'RESOLUTION=[0-9x]*' | tr '\n' ' '; echo
BASE="${URL%master.m3u8}"
V=$(echo "$MASTER" | grep -v '^#' | grep m3u8 | tail -1)
PL=$(curl -sS "$BASE$V"); SEG=$(echo "$PL" | grep -v '^#' | grep m4s | head -1); INIT=$(echo "$PL" | grep -o 'URI="[^"]*"' | head -1 | cut -d'"' -f2)
VDIR="${V%index.m3u8}"
[[ $(curl -sS -o /dev/null -w '%{http_code}' "$BASE$VDIR$INIT") == 200 && $(curl -sS -o "$TMP/seg.m4s" -w '%{http_code}' "$BASE$VDIR$SEG") == 200 ]] && ok "init + first segment play through the same link (token inherited)"
curl -sS -o "$TMP/init.mp4" "$BASE$VDIR$INIT"; cat "$TMP/init.mp4" "$TMP/seg.m4s" > "$TMP/play.mp4"
docker run --rm -v "$TMP":/data --entrypoint ffprobe lens-transcoder -v error -show_entries stream=codec_name,width,height -of csv=p=0 /data/play.mp4 | head -2

BAD=$(echo "$URL" | sed -E 's#(/t/[0-9]+-)[0-9a-f]#\10#')
[[ "$BAD" != "$URL" && $(curl -sS -o /dev/null -w '%{http_code}' "$BAD") == 403 ]] && ok "forged link refused (403)"
KEY=$(cat keys/stream-token.key); FOLDER="/${BASE#*/t/*/}"; FOLDER="/h/${BASE#*/h/}"
EXP=$(( $(date +%s) - 60 )); SIG=$(printf '%s' "$EXP:$FOLDER" | openssl dgst -sha256 -hmac "$KEY" -hex | awk '{print $2}' | cut -c1-32)
CDN=$(echo "$URL" | cut -d/ -f3)
[[ $(curl -sS -o /dev/null -w '%{http_code}' "https://$CDN/t/$EXP-$SIG${FOLDER}master.m3u8") == 403 ]] && ok "expired link refused (403)"
[[ $(curl -sS -o /dev/null -w '%{http_code}' "https://$CDN${FOLDER}master.m3u8") == 403 ]] && ok "no direct access to streaming files without a link"

call DELETE "/media/$ID/forever" "$T" >/dev/null
N=$(aws s3api list-object-versions --profile lens --bucket "$BUCKET" --prefix "${FOLDER#/}" --output json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=d.trim()?JSON.parse(d):{};console.log((o.Versions||[]).length+(o.DeleteMarkers||[]).length)})")
[[ $N == 0 ]] && ok "delete forever removed the streaming copies too"
echo "STREAM TEST PASSED"
