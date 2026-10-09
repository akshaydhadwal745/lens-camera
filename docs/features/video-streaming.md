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

| Source (short side) | Versions |
|---|---|
| ≥ 1000 px (1080p, 4K…) | 540p (1.5 Mbps) + 1080p (5 Mbps) |
| 540–999 px (720p…) | 540p |
| < 540 px | its own size (never upscaled) |

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
