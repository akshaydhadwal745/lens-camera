# Cloud upload, previews and storage

**Promise:** shoot endlessly; originals are kept at full quality in the cloud and
the phone keeps only what it needs.

**Code:** `src/lib/uploader.ts`, `src/lib/store.ts`, `src/lib/derivatives.ts`,
`src/lib/local-store.ts`; server `infra/lambda/api/media.ts`.

## What happens after you take a shot

1. The original is saved on the phone (never re-encoded).
2. A **thumbnail** (400 px) and **preview** (2048 px JPEG) are made on the phone
   (milliseconds; videos get one poster frame). If the shot has a look, they show it.
3. Thumbnail + preview upload **first, on any network** — the item appears on your
   other devices and the website within seconds.
4. The **original** uploads next, following the mobile-data setting.
5. The server checks the stored file and marks it verified. Then the local original
   becomes eligible for the storage guardian.

## Upload while recording (Android)

Videos start uploading **while you record**, so a long video is almost
entirely in the cloud by the time you press stop.

- The camera writes the video to a file that only grows while recording; when
  recording stops, Android's MP4 writer rewrites the header at the start and
  adds its index at the end.
- Lens starts an S3 multipart upload (size unknown) when recording starts and,
  every 2 s, sends each finished 8 MiB block, **holding back the first 16 MiB**
  (header area) and staying 1 MiB behind the writer.
- When recording stops it re-checks the MD5 of every block already sent against
  the final file, re-sends any that changed, sends the rest, and completes with
  the final size. The cloud copy is byte-for-byte the phone's file (every block
  is also MD5-checked by S3 on arrival).
- If it's interrupted (app killed, network drop), the regular uploader finishes
  it and re-checks already-sent blocks against S3's part MD5s.
- **Setting** (Settings → Uploads → Upload videos while recording): Wi-Fi only
  (default) · Wi-Fi + mobile data · Off. Pauses when the phone is hot. Only
  when originals go to Lens storage (own storages get the file after recording).
- Code: `src/lib/live-upload.ts`, `startLiveUpload`/`finishLiveUpload` in
  `store.ts`; API `POST /media {streaming: true}`, `POST /media/:id/complete {size}`.
  Tests: `infra/scripts/e2e.sh`, `tests/live-upload/run.sh`.

## Heat guard

A small native module (`modules/lens-device`: Android `PowerManager` thermal
status, iOS `ProcessInfo.thermalState`) reports **normal / warm / hot /
critical**. When **hot or critical**: uploads (including upload-while-recording)
and preview-making pause, the iPhone pro camera turns off its analysis overlays
(histogram, zebras, focus peaking, false color), and the gallery shows "Phone is
hot. Uploads are paused until it cools down". Everything resumes automatically
when it cools.

## Storage guardian (the phone never fills up)

Once an original is verified in the cloud, the phone may drop its full-size
file and keep only the thumbnail + preview. The gallery stays complete and
works offline; opening the item shows the preview, and the full-quality
original loads from the cloud (automatically on Wi-Fi, HD button on mobile data).

The original is removed from the phone when **any** of these is true:

| Trigger | What happens |
|---|---|
| Older than "Keep originals on phone for" | Removed on app start / return to the app |
| Free space below "Always keep free on phone" | First deletes re-downloadable cached files (shared/saved/edited cloud originals), then removes the **oldest** verified originals until there's enough room |
| You tap "Free up space now" | Removes every verified original |

When the guardian checks free space: app start, every return to the app, after
every capture, after every original finishes uploading, and when Settings opens.

**Rules:** anything not yet verified in the cloud is never touched. Items with
no local preview (rare: preview creation failed) are removed entirely and show
from the cloud listing instead.

**Phone almost full:** if free space drops under 500 MB and nothing can be
removed yet (everything left is still waiting to upload), the gallery shows an
orange "Phone almost full" banner until uploads catch up.

**After an original is removed:** share / Save to Photos downloads it from the
cloud first. Photo edits render from the cloud original. Video looks can only be
changed while the video is still on the phone that recorded it.

**Code:** `guardSpace`, `runCleanup`, `freeUpSpace`, `offloadOriginals` in
`src/lib/store.ts`; `deleteOriginal`, `freeDiskBytes`, `clearDownloadCache` in
`src/lib/local-store.ts`. A removed item keeps its `LocalEntry` with
`offloadedAt` set.

## Integrity (zero quality loss)

- Every upload request carries the MD5 of exactly the bytes being sent; it's part
  of the signed URL, so storage **rejects anything altered in transit**.
- Big files upload in parts (≥8 MB, sized so even 1 TB files stay under the
  10,000-part limit), 3 at a time on Wi-Fi, 2 on mobile data.
- Interrupted uploads resume: the app asks which parts already arrived and sends
  only the rest (after a crash, app kill or network drop).
- Originals are stored as-is; edits never touch them.

## Settings

| Setting | Options | Default |
|---|---|---|
| Upload over mobile data | Everything · Up to 100 MB · Wi-Fi only | Up to 100 MB (big videos wait for Wi-Fi) |
| Keep originals on phone for | 1 · 3 · 7 · 30 days · Always | 7 days |
| Always keep free on phone | Off · 1 · 2 · 5 · 10 GB | 2 GB |
| Free up space now | Removes originals already safe in the cloud (previews stay) | — |

Settings → On this device also shows how many originals are on the phone, how
many items are preview-only, and the phone's free space.

Thumbnails/previews always upload, even on mobile data (they're tiny).

## Status icons (gallery tiles)

| Icon | Meaning |
|---|---|
| Cloud with arrow (grey) | Waiting to upload |
| Percentage | Uploading |
| Cloud with arrow (blue) | Visible everywhere; full-quality original still uploading |
| Cloud with tick | Original only in the cloud (this phone may keep just the preview) |
| Red ! | Upload failed — tap the banner to retry |

## Cloud storage

- Originals: S3 **Intelligent-Tiering** (gets cheaper as files age, opens instantly — no waiting tiers).
- Thumbnails/previews: S3 Standard, served through CloudFront with signed URLs.
- Deleted/overwritten objects are recoverable for 30 days (versioning).
- Per-user limit: 100 GB while testing.
