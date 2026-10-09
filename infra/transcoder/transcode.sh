#!/usr/bin/env bash
# Usage (env): BUCKET, KEY (m/<owner>/<id>.<ext>), OUT (h/<owner>/<id>/), TABLE, OWNER, MEDIA_ID
# Safe to re-run (Spot interruption → Batch retries): works in a temp folder,
# uploads, and only then marks the video's stream ready.
set -euo pipefail
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

# LOCAL_IN/LOCAL_OUT: test mode without AWS (docker run -v …).
if [[ -n ${LOCAL_IN:-} ]]; then cp "$LOCAL_IN" in.media; else aws s3 cp --only-show-errors "s3://$BUCKET/$KEY" in.media; fi

# Rungs by the short side (portrait stays portrait), up to the original's own
# resolution (4K stays 4K), never upscaled. The player picks the best rung the
# connection can carry; a slow connection drops to a lower one instead of stalling.
SHORT=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x in.media \
  | awk -Fx '{print ($1<$2)?$1:$2}')
HAS_AUDIO=$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 in.media | head -1)
TRANSFER=$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer -of csv=p=0 in.media | head -1)
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -of csv=p=0 in.media | head -1 \
  | awk -F/ '{ if ($2 > 0) printf "%d", $1/$2; else print 30 }')

scale() { echo "scale='if(gt(iw,ih),-2,$1)':'if(gt(iw,ih),$1,-2)'"; }
# Never upscale: smaller sources get one rung at their own size (even number).
if (( SHORT >= 2000 )); then RUNGS=(540 1080 1440 2160)
elif (( SHORT >= 1400 )); then RUNGS=(540 1080 1440)
elif (( SHORT >= 1000 )); then RUNGS=(540 1080)
elif (( SHORT >= 540 )); then RUNGS=(540)
else RUNGS=($(( SHORT / 2 * 2 ))); fi
# Generous bitrates (H.264): the top rung should look like the original.
declare -A BITRATE=([540]=1500k [1080]=6000k [1440]=10000k [2160]=20000k)
declare -A MAXRATE=([540]=2000k [1080]=8000k [1440]=13000k [2160]=26000k)
for r in "${RUNGS[@]}"; do : "${BITRATE[$r]:=900k}" "${MAXRATE[$r]:=1200k}"; done
# 50/60 fps (smooth motion is kept) needs more bits for the same quality.
if (( FPS > 40 )); then
  for r in "${RUNGS[@]}"; do
    BITRATE[$r]=$(( ${BITRATE[$r]%k} * 3 / 2 ))k
    MAXRATE[$r]=$(( ${MAXRATE[$r]%k} * 3 / 2 ))k
  done
fi
# HDR recordings (HLG / PQ): tone-map to normal video so streams look right
# everywhere instead of washed out. The original keeps its HDR.
TONEMAP=""
if [[ $TRANSFER == arib-std-b67 || $TRANSFER == smpte2084 ]]; then
  TONEMAP="zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,"
fi

FILTER="[0:v]${TONEMAP}split=${#RUNGS[@]}"; for i in "${!RUNGS[@]}"; do FILTER+="[s$i]"; done; FILTER+=";"
ARGS=(); MAP=""
for i in "${!RUNGS[@]}"; do
  r=${RUNGS[$i]}
  FILTER+="[s$i]$(scale "$r")[v$i];"
  ARGS+=(-map "[v$i]" -c:v:$i libx264 -preset veryfast -profile:v:$i high
         -b:v:$i "${BITRATE[$r]}" -maxrate:v:$i "${MAXRATE[$r]}" -bufsize:v:$i "${MAXRATE[$r]}")
  if [[ -n $HAS_AUDIO ]]; then ARGS+=(-map 0:a:0); MAP+="v:$i,a:$i "; else MAP+="v:$i "; fi
done
FILTER=${FILTER%;}

mkdir -p out
ffmpeg -hide_banner -loglevel warning -y -i in.media -filter_complex "$FILTER" "${ARGS[@]}" \
  $( [[ -n $HAS_AUDIO ]] && echo "-c:a aac -b:a 128k -ac 2" ) \
  -pix_fmt yuv420p -force_key_frames "expr:gte(t,n_forced*2)" -sc_threshold 0 \
  -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags independent_segments \
  -master_pl_name master.m3u8 -var_stream_map "${MAP% }" \
  -hls_segment_filename "out/%v/seg%05d.m4s" out/%v/index.m3u8

if [[ -n ${LOCAL_OUT:-} ]]; then cp -r out/. "$LOCAL_OUT"/; echo "local: ${RUNGS[*]}"; exit 0; fi

# Segments first, playlists last: a player never sees a playlist before its segments.
aws s3 cp --only-show-errors --recursive out "s3://$BUCKET/$OUT" --exclude "*.m3u8" \
  --content-type video/iso.segment --exclude "*/init_*.mp4" --cache-control "public, max-age=31536000, immutable"
aws s3 cp --only-show-errors --recursive out "s3://$BUCKET/$OUT" --exclude "*" --include "*/init_*.mp4" \
  --content-type video/mp4 --cache-control "public, max-age=31536000, immutable"
aws s3 cp --only-show-errors --recursive out "s3://$BUCKET/$OUT" --exclude "*" --include "*.m3u8" \
  --content-type application/vnd.apple.mpegurl --cache-control "public, max-age=300"

aws dynamodb update-item --table-name "$TABLE" \
  --key "{\"pk\":{\"S\":\"D#$OWNER\"},\"sk\":{\"S\":\"M#$MEDIA_ID\"}}" \
  --update-expression "SET streamStatus = :r, streamReadyAt = :t, streamRungs = :g" \
  --expression-attribute-values "{\":r\":{\"S\":\"ready\"},\":t\":{\"N\":\"$(date +%s%3N)\"},\":g\":{\"S\":\"${RUNGS[*]}\"}}"
echo "done: ${RUNGS[*]}"
