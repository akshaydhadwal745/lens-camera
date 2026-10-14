#!/usr/bin/env bash
# Recap video (docs/design/switch-features.md §4): a short film from a trip's or
# event's best photos. Each photo gets a slow push-in (Ken Burns), photos
# crossfade, the title sits on the first shot. Made from the 2048 px previews
# (never the originals: smaller, already oriented), so it's cheap and quick.
#
# Usage (env): BUCKET, PREFIX (r/<owner>/<recap>/). Reads PREFIX/manifest.json:
#   { "title": "Goa · 12–15 Oct", "orientation": "portrait"|"landscape", "items": [{ "key": "d/…/preview.jpg" }] }
# Writes PREFIX/recap.mp4, thumb.jpg, preview.jpg and, last, done.json
# ({ size, duration, width, height }). Safe to re-run (Spot interruption).
# LOCAL_DIR: test mode without AWS (manifest.json + the images' files by basename).
set -euo pipefail
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

get() { if [[ -n ${LOCAL_DIR:-} ]]; then cp "$LOCAL_DIR/$(basename "$1")" "$2"; else aws s3 cp --only-show-errors "s3://$BUCKET/$1" "$2"; fi; }
if [[ -n ${LOCAL_DIR:-} ]]; then cp "$LOCAL_DIR/manifest.json" manifest.json; else aws s3 cp --only-show-errors "s3://$BUCKET/${PREFIX}manifest.json" manifest.json; fi

ORIENT=$(jq -r '.orientation // "portrait"' manifest.json)
TITLE=$(jq -r '.title // ""' manifest.json)
if [[ $ORIENT == landscape ]]; then W=1920; H=1080; else W=1080; H=1920; fi
FPS=30
DUR=2.6     # seconds each photo is on screen (crossfade included)
FADE=0.6
FRAMES=$(awk -v d=$DUR -v f=$FPS 'BEGIN{printf "%d", d*f}')
# Rendered slightly larger, then the push-in crops back to the frame (no black edges).
BW=$(( W * 112 / 100 / 2 * 2 )); BH=$(( H * 112 / 100 / 2 * 2 ))

mapfile -t KEYS < <(jq -r '.items[].key' manifest.json)
N=${#KEYS[@]}
(( N >= 2 )) || { echo "need at least 2 photos" >&2; exit 2; }

# 1) One short clip per photo (fixed size, so the crossfades line up).
for i in "${!KEYS[@]}"; do
  get "${KEYS[$i]}" "in$i.jpg"
  # Alternate the direction of the slow move so it doesn't feel mechanical.
  if (( i % 2 )); then Z="1.10-0.0012*on"; else Z="1.0+0.0012*on"; fi
  # A photo shaped against the frame (landscape in a vertical recap, or the reverse) is shown
  # whole over a blurred, dimmed copy of itself instead of losing most of it to a crop.
  read -r PW PH < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "in$i.jpg" | tr x ' ')
  if (( (PW > PH) != (W > H) )); then
    BASE="split[a][b];[a]scale=${BW}:${BH}:force_original_aspect_ratio=increase,crop=${BW}:${BH},boxblur=40:2,eq=brightness=-0.12[bg];[b]scale=${BW}:${BH}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2"
  else
    BASE="scale=${BW}:${BH}:force_original_aspect_ratio=increase,crop=${BW}:${BH}"
  fi
  ffmpeg -hide_banner -loglevel error -y -loop 1 -t "$DUR" -i "in$i.jpg" \
    -filter_complex "[0:v]${BASE},zoompan=z='${Z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${FRAMES}:s=${W}x${H}:fps=${FPS},format=yuv420p[v]" \
    -map "[v]" -frames:v "$FRAMES" -c:v libx264 -preset veryfast -crf 16 "clip$i.mp4"
done

# 2) Crossfade them into one film; the title on the first shot.
INPUTS=(); for i in $(seq 0 $((N - 1))); do INPUTS+=(-i "clip$i.mp4"); done
FILTER=""; PREV="[0:v]"
for i in $(seq 1 $((N - 1))); do
  OFFSET=$(awk -v i=$i -v d=$DUR -v f=$FADE 'BEGIN{printf "%.3f", i*(d-f)}')
  FILTER+="${PREV}[$i:v]xfade=transition=fade:duration=${FADE}:offset=${OFFSET}[x$i];"
  PREV="[x$i]"
done
FONT=$(fc-match -f '%{file}' 'DejaVu Sans:bold' 2>/dev/null || true)
if [[ -n $TITLE && -n $FONT ]]; then
  printf '%s' "$TITLE" > title.txt
  SIZE=$(( W / 16 ))
  FILTER+="${PREV}drawtext=fontfile=${FONT}:textfile=title.txt:fontsize=${SIZE}:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.78:enable='lt(t,${DUR})'[out]"
else
  FILTER+="${PREV}null[out]"
fi
ffmpeg -hide_banner -loglevel error -y "${INPUTS[@]}" -filter_complex "$FILTER" -map "[out]" \
  -c:v libx264 -preset medium -crf 20 -profile:v high -pix_fmt yuv420p -r $FPS -movflags +faststart recap.mp4

# 3) Thumbnail + preview (the second shot: past the title), then the "done" marker.
ffmpeg -hide_banner -loglevel error -y -ss "$DUR" -i recap.mp4 -frames:v 1 -vf "scale='if(gt(iw,ih),2048,-2)':'if(gt(iw,ih),-2,2048)'" -q:v 3 preview.jpg
ffmpeg -hide_banner -loglevel error -y -i preview.jpg -vf "scale='if(gt(iw,ih),400,-2)':'if(gt(iw,ih),-2,400)'" -q:v 4 thumb.jpg
SIZE_B=$(stat -c %s recap.mp4)
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 recap.mp4)
printf '{"size":%s,"duration":%s,"width":%s,"height":%s}\n' "$SIZE_B" "$DURATION" "$W" "$H" > done.json

if [[ -n ${LOCAL_DIR:-} ]]; then
  mkdir -p "${LOCAL_OUT:-$LOCAL_DIR/out}"; cp recap.mp4 thumb.jpg preview.jpg done.json "${LOCAL_OUT:-$LOCAL_DIR/out}/"
else
  for f in recap.mp4 thumb.jpg preview.jpg; do aws s3 cp --only-show-errors "$f" "s3://$BUCKET/${PREFIX}$f"; done
  aws s3 cp --only-show-errors done.json "s3://$BUCKET/${PREFIX}done.json"
fi
echo "recap: $N photos, ${DURATION}s, $SIZE_B bytes"
