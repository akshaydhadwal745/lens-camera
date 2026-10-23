# Move to my Google Drive

Settings → Storage → **Move to my Google Drive** (shown when Google Drive is the connected storage).
Lens copies the originals kept in Lens storage into the person's Google Drive (`Lens` folder), checks
each copy, then frees the Lens space. Previews stay in Lens, so the gallery looks the same.

## How it works
1. The app asks `GET /v1/move` for a quote: items and bytes that can move, the free allowance left,
   credit, and the price.
2. On "Move", the phone sends its Google Drive refresh token for this job only (`POST /v1/move`).
   The server checks it works, seals it (AES-GCM, key derived from the CloudFront key) in
   `D#<id>/MOVE`, and deletes it when the job stops (done, paused, cancelled).
3. Above the free allowance: a Razorpay **payment link** (`payUrl`); the move starts when it's paid
   (webhook `payment_link.paid`, the app coming back → `POST /v1/move/refresh`, or the 15-minute tick).
4. The Maintenance Lambda (`{ driveMove: <id> }`) streams each original S3 → Drive (resumable
   upload, 16 MiB chunks), computes the MD5 on the way and compares it with Drive's `md5Checksum`.
   Then, in one transaction: the media record gets `location = { gdrive, ref, md5 }` and the profile's
   `usedBytes` drops. The S3 original is deleted (the bucket is versioned: recoverable 30 days).
   It continues itself before the 10-minute limit; a stalled job is restarted by the 15-minute tick.
5. Done / Drive full / signed out → push + email; the app shows Continue.

## What stays in Lens
Items shared with people (they keep the full-quality original), videos without a streaming copy yet,
deleted items (Trash/Archive), recap films, files over 4 GB.

## Price (owner decision 2026-10-23)
"Moving uses our internet bandwidth: charge after some GB." AWS data out of Mumbai ≈ $0.109/GB
(≈ ₹9.6) after the account's free 100 GB/month. **First 10 GB per account free, then ₹15 per GB**
(incl. 18% GST; ≈ ₹12.4 net after GST and Razorpay's ~2%). Constants `MOVE_FREE_BYTES`,
`PRICE_PER_GB_PAISE` in `infra/lambda/api/drive-move.ts`. Paid GB not used stay as
`PROFILE.moveCreditBytes`. Play Store build: only free moves until Play Billing exists.

## Privacy
Privacy policy §2 (EN/HI) describes the one-time sign-in hand-over; terms §4 the price.

## Not tested yet
A real end-to-end move needs a Google Drive sign-in on a phone (e2e covers the quote and checks).
