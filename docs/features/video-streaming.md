# Smooth video streaming (Step 5)

**Promise:** long videos play smoothly on any phone, even a 40 GB one, without
downloading the whole original first.

**Code:** API `infra/lambda/api/stream.ts`; converter `infra/transcoder/`
(Dockerfile + `transcode.sh`); stack `lens-stack.ts` (Batch, CloudFront
`t/*` + `StreamAuth` function); app `src/lib/useStream.ts`, viewer `VideoPage`.
Tests: `tests/stream/run.sh` (full conversion on AWS), `infra/scripts/e2e.sh`.

## When it happens

Only when a video is played **from the cloud** (not on this phone) and it's
**long (≥ 60 s) or big (≥ 100 MB)**. Short clips just play the original.

1. The viewer asks Lens how to play it (`POST /v1/stream`).
2. First time: Lens starts a conversion and the **original plays meanwhile**
   ("Preparing smooth playback for next time…"). It takes about a minute.
3. From then on: adaptive streaming. The player switches between versions
   based on the connection.

Videos stored in someone's own storage (Drive, Dropbox…) play from there as
before; the server can't fetch those originals.

## What's made

HLS with fMP4 segments of 4 s (keyframe every 2 s), H.264 High + AAC 128k
(plays on every Android phone):

Up to the original's own resolution, never upscaled. The player picks the
best version the connection carries; a slow connection drops to a lower one
instead of stalling, and goes back up when it can.

| Source (short side) | Versions (30 fps bitrates) |
|---|---|
| ≥ 2000 px (4K) | 540p (1.5) + 1080p (6) + 1440p (10) + 2160p (20 Mbps) |
| 1400–1999 px (1440p) | 540p + 1080p + 1440p |
| 1000–1399 px (1080p) | 540p + 1080p |
| 540–999 px (720p…) | 540p |
| < 540 px | its own size |

- **50/60 fps** videos keep their frame rate, with 1.5× the bitrate.
- **HDR** recordings (HLG/PQ) are tone-mapped to normal video for streaming,
  so they look right on every screen instead of washed out. The original keeps
  its HDR (download / Save to Photos).
- Short clips (< 60 s and < 100 MB) aren't converted at all: the original plays.
- Changed 2026-10-09 (was 540p + 1080p only). Needs a deploy to take effect;
  tested locally on a 4K 60 fps HLG clip (all 4 versions made, 40 s for 2 s
  of 4K on this PC without a GPU).

Portrait videos stay portrait. Stored under `h/{owner}/{id}/`, kept **90 days**
(S3 lifecycle), then re-made the next time someone plays the video. Deleting
the video forever also deletes them.

## How it runs (cost-first)

- **AWS Batch on Fargate Spot** (about 70% cheaper than normal), 4 vCPU / 8 GB,
  public subnets (no NAT gateway cost). A 65 s 720p test video converted in 46 s.
  Roughly ₹0.3–1 per long video, once.
- **Spot interruptions:** Batch retries up to 3 times (the script is safe to
  re-run: it marks the video ready only after every file is uploaded). If a
  job still fails, the next play re-submits it to **on-demand** capacity
  (never interrupted). Viewers always have the original meanwhile.
- **Links:** `https://<cdn>/t/{exp}-{sig}/h/{owner}/{id}/master.m3u8`, valid
  6 h. The HMAC signature covers the video's folder, so the playlists'
  relative segment URLs inherit it. A CloudFront Function checks it and strips
  it before the cache (all viewers share cached segments). Forged, expired or
  direct requests get 403. The secret lives in `infra/keys/stream-token.key`
  (gitignored) and SSM `/lens/stream/token-key`.
