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
5. The server checks the stored file and marks it verified. Then the local copy
   becomes eligible for cleanup.

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
| Keep local copies for | 1 · 3 · 7 · 30 days · Always | 7 days |
| Free up space now | Removes local copies already safe in the cloud | — |

Thumbnails/previews always upload, even on mobile data (they're tiny).

## Status icons (gallery tiles)

| Icon | Meaning |
|---|---|
| Cloud with arrow (grey) | Waiting to upload |
| Percentage | Uploading |
| Cloud with arrow (blue) | Visible everywhere; full-quality original still uploading |
| Cloud with tick | Only in the cloud (not on this phone) |
| Red ! | Upload failed — tap the banner to retry |

## Cloud storage

- Originals: S3 **Intelligent-Tiering** (gets cheaper as files age, opens instantly — no waiting tiers).
- Thumbnails/previews: S3 Standard, served through CloudFront with signed URLs.
- Deleted/overwritten objects are recoverable for 30 days (versioning).
- Per-user limit: 100 GB while testing.
