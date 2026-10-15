# Five features that make people pick Lens over the stock camera

Status: plan agreed by the user 2026-10-14 (order 1 → 5). Audit of what exists first,
then milestones, success criteria and tests per feature. Update the status lines as
milestones land.

The idea behind the order: stock cameras win on capture (years of tuning), so Lens must
first stop losing there (1), then win on what happens after the shot (2–4), then add a
capture feature stock cameras on most phones don't have (5).

## Audit (2026-10-14)

| Area | What exists | Gap |
|---|---|---|
| Capture pipeline | CameraX 1.6, `stillCapture(latency)` = MAXIMIZE_QUALITY by default, MINIMIZE_LATENCY for Night frames / burst / `captureMode: 'latency'`; JPEG 95; Ultra HDR; RAW; maker extensions with watchdog; captures finish behind other screens (`capturesInFlight`, dev-95) | Shutter is blocked until the file is saved; no ZSL; no per-capability mode choice; only press→saved is measured |
| Shutter measurements | Self-test steps `shutter-uhdr / -jpeg / -latency`, press→saved, 3 shots | Missing press→capture-start (the moment the photo is taken) and shot-to-shot |
| Measured (press→saved, ms) | best quality: Pixel 6 1400–2000, Pixel 8a 1400, A14 1750, Xiaomi 1750, OPPO 2080, Moto 1400, S9 1800–2100, S25 Ultra (Ultra HDR) 2500 · quick: Pixel 6 600, Pixel 8a 545, A14 545, Xiaomi 553, S25 Ultra 855, S9 1230 | Quality cost of quick capture not measured yet |
| Free up space | `guardSpace` (keep N GB free), retention days, Settings → **Free up space now** (`freeUpSpace`), only originals verified in the cloud (`offloadable`, MD5 on every upload), previews kept, "spaceFreed" banner | Only Lens's own files. Gallery imports (and photos the user saved to Photos) stay in the phone gallery: no MediaStore delete, no "freed X GB" for them, no per-item failure reporting |
| Albums / sharing | Albums (`albums.ts`: AL#/AI#/AM#/SA#), shared album = share request with consent, access per item, Nearby, People link to friends, web viewer for shares | Members can't **add**; no join link / QR; no guests; web has no upload |
| Places / People / best shot | Places (on-device reverse geocode, server places.ts), People (on-device face grouping), burst `BurstPicker` (sharpness + eyes open + smile per frame, ML Kit) | No trips/events grouping, no recap album or video, no cloud renderer for photos |
| Video rendering | Transcoder (ffmpeg on Graviton Spot via S3→SQS→Batch) for HLS | Could render recap videos with the same pipeline |
| Known issue | S9-class phones: video export right after a 4K recording fails (codec capacity: camera keeps a 4K encoder for the next recording + export needs 4K decode + encode). Self-test dev-95 2/2, passed dev-68/85/90 | Fix before bake-looks/4K is promoted further (pause the camera's video use case during export, or export at the source's codec budget) |

## 1. Fast shutter (in progress)

Status 2026-10-14: milestones 1 + 2 built (commit after b9f66cf): native `lagMs` / `savedMs` /
`captureMode` on every photo, `captureMode: 'zsl'` (ZSL where `isZslSupported`, JPEG, no
extension; else quick), `onCaptureStarted` event; self-test steps `shutter-*` record lag,
press→saved and 3 rapid presses (all must save), `shutter-zsl`, and `shutter-quality` uploads
one photo per path as a Quality Lab set (`analyze.py report <setId>`). ProCamera frees the
shutter on capture start (Night/Astro/baked looks stay locked). Next: Device Farm numbers →
milestone 3 (default path per capability).

**Device Farm dev-97 (2026-10-14):** Galaxy S9: best quality lag 2005 ms / saved 2211 ms / 3 rapid
4.4 s; quick 1042 / 1241 / 2.7 s; ZSL 923 / 1090 / 1.7 s; all rapid presses saved. **ZSL photo on
the S9 was completely black** (dark rack scene: quality and quick show the same faint scene,
ZSL 242 KB flat black) → ZSL is not trusted from `isZslSupported` alone; needs a runtime check
(photo vs preview brightness) before it can be a default. Quick looks identical to best quality
in that scene, but it's too dark to compare detail/noise: needs a lit scene (S8 Quality Lab).
Pixel 6: app crashed in the Maker NIGHT step (CameraX closing the extension session after a
camera HAL error, `CameraAccessException` on a CXCP thread); re-running to see if it repeats.
Pixel 6 re-run: no crash (Maker NIGHT hung → watchdog, as in dev-90/95), so the crash was a
one-off HAL error, still worth guarding. Pixel 6: quality lag 1401 / saved 1422 / 3 rapid 2.8 s;
quick 599 / 615 / 1.0 s; ZSL not supported (bound quick). Device Farm racks are dark (all
samples near black) → quality needs a lit scene: Test Lab run on dev-97, or the S8 self-test.
Emulator: every tap arrives as a long press (software GPU, slow JS thread) → the burst path
takes the photo, so the tap path can't be tested there (a long press while a photo holds the
shutter now queues a shot, which helps slow phones too). Volume keys also queue.
**Decision so far:** ZSL stays a lab-only mode until a runtime check (photo vs preview
brightness) exists. Candidate default: quick capture + pipelined shutter, pending the
lit-scene quality comparison.

**Lit-scene comparison + automatic path (2026-10-15, dev-124 → dev-125):** the user's Galaxy S8 in
office light (Quality Lab set 2026-10-15-33o3ZY7Y): quick = best quality (noise 4.11 vs 4.07,
detail 2.41 vs 2.47, ZSL same as quick), and quick is faster (saved 0.84 s vs 1.14 s, 3 rapid
1.5 s vs 2.4 s). The burst's switch to the quick path costs 0.9–1.5 s before the first shot
(the camera session rebuilds), so on the S8 a 1.5 s hold gave 1 shot. **Now automatic
(`captureMode: 'auto'`, the default):** Photo mode with plain JPEG binds the quick path in
normal light and moves to best quality when the scene stays dim (`isDark()`: ISO ≥ 800, or
≥ 1/20 s at ISO ≥ 400) for 2 s; back to quick when bright (ISO ≤ 400, ≤ 1/30 s) for 2 s. The
switch waits until no photo, burst or recording is in progress. Smart burst on the quick path
needs no switch. Ultra HDR, RAW, maker modes, Portrait and Night keep their own paths. No
setting (feedback: automatic, not options). Self-test: `shutter-auto`, `burst-auto`.

**Goal:** the photo is taken the moment the shutter is pressed, and the next press is
accepted at once, with no loss in image quality.

Two different delays, both felt as "lag":
- **Shutter lag**: press → the frame is captured. Fixed by the capture mode: ZSL
  (zero shutter lag: a ring buffer of recent frames, reprocessed at full quality)
  where `CameraInfo.isZslSupported`, else MINIMIZE_LATENCY, else best quality.
- **Shot-to-shot**: press → shutter accepts the next press. Today the shutter stays
  locked until the JPEG is written (1.4–2.5 s). Fix: unlock on capture start
  (`onCaptureStarted`), let saves finish in the background (CameraX queues requests),
  each save lands in the roll when ready. Night, Astro, burst and timer keep locking.

Milestones:
1. **Measure the right things** (native + self-test): every photo reports
   `lagMs` (press → capture started) and `savedMs` (press → file saved); new self-test
   steps per mode (best quality, quick, ZSL where supported) record lag, shot-to-shot over
   3 rapid presses, and keep one photo per mode for quality comparison
   (`research/analyze.py` sharpness + noise on the same scene).
2. **Pipelined shutter** in ProCamera photo / portrait modes: unlock on capture start,
   several captures in flight, gallery tap still safe (`capturesInFlight`).
3. **Pick the mode per capability from the numbers**: ZSL where supported and not worse
   in quality; quick capture where its quality is within the threshold; best quality +
   pipelining otherwise. No per-model tables (docs/research/camera-quality.md: decide by capability, from measurements).
4. Validate: Device Farm Pixel 6 + S9 (+ Test Lab A14 / OPPO / Pixel 8a), S8 by hand.

Success criteria:
- Shutter lag p50 ≤ 250 ms on mid/flagship phones, ≤ 400 ms on S8/S9-class.
- Shot-to-shot ≤ 600 ms (3 rapid presses all saved, in order, none lost).
- Quality: lab sharpness ≥ 95 % and noise ≤ 105 % of today's best-quality path on the
  same scene, same phone; otherwise that phone keeps best quality + pipelining.
- No new self-test failures; gallery-right-after-shutter still saves every photo.

## 2. Free up space

Status 2026-10-14: built and **verified end to end on the Android 14 emulator (dev-109)**: 3 gallery photos imported → uploaded → Settings showed "Remove 3 backed-up from phone gallery (474 KB)" → Lens's confirm → Android's photos permission (asked only then) → MD5 check passed → Android's "Allow Lens to delete 3 photos?" listing exactly those files → gallery 3 → 0, roll still 17 frames ALL SAFE. Still to check on a phone: Android 9 (S8, direct delete path). Decision taken while the user was away
(they said not to wait): use the media permission, asked only when the user taps the
Remove button; Play declaration before a Play release. See docs/features/cloud-and-storage.md.

Lens's own originals are already offloaded safely. Missing: the **phone gallery**.
- After an import (or for photos also saved to Photos) is verified in the cloud, offer
  "Remove N photos from your phone gallery · frees X GB".
- Android 11+: `MediaStore.createDeleteRequest` (one system confirmation for the batch,
  items go to the system trash). Android 10: per-item `RecoverableSecurityException`
  flow. Android 9 and older (S8): `WRITE_EXTERNAL_STORAGE` + ContentResolver delete
  with our own confirmation.
- Never delete unless: the cloud copy exists, its MD5 matches the local file at delete
  time (re-hash just before), and the user approved this batch. Partial failures are
  listed and kept.
- Show freed bytes from the file sizes actually deleted (`StatFs` before/after as a check).
- Optional later: scan the gallery for items already in Lens (MD5 dedup) and offer to
  remove those.

**Decision needed before building (user):** imports use Android's photo picker (no
permission, `MediaPickerContract`); picker URIs (`content://media/picker/…`) can't be passed
to `MediaStore.createDeleteRequest`, and `READ_MEDIA_*` are in app.json `blockedPermissions`.
Deleting from the gallery needs the media permission (Android 13+: READ_MEDIA_IMAGES/VIDEO;
≤ 12: READ_EXTERNAL_STORAGE; ≤ 9 delete also WRITE_EXTERNAL_STORAGE). Play's Photo and Video
Permissions policy allows it for photo backup apps with a Play Console declaration. It also
unlocks gallery dedup ("already in Lens") and a real "free X GB" scan.

Success: 0 deletions without a verified cloud copy (unit tests on the decision function
+ e2e with a corrupted upload); works on Android 9, 11, 14 (emulator + S8); freed bytes
within 1 % of StatFs difference.

## 3. Shared event albums (QR / link)

Status 2026-10-14: v1 built (backend `infra/lambda/api/events.ts` + albums.ts changes, app
screens, website `/e/<code>` page, CloudFront `/e/` rule), **not deployed yet** (the deploy needs
the user). e2e has 21 event checks. Web guests can view and **add photos from the browser** (POST /web/guest cookie session,
browser-made thumb/preview, MD5-checked, photos ≤ 16 MB, 50 per batch). Next: video from the
browser, guest → account merge on web sign-in.

Builds on albums + shares + Nearby + People.
- Album gets an **event mode**: `contributors: true`, a join code (random, revocable,
  optional expiry), QR + `lens.instagrowapp.com/e/<code>` link.
- Joining (app): one tap, the album appears under Albums; contributors can add their
  own photos (they stay in the contributor's storage and quota; the album holds
  references, like today's AI# records but with an `addedBy`).
- Web guests: open the link, see the album, add photos with a guest name (no account):
  per-guest and per-album caps (count/size/day), rate limits, type/size checks,
  EXIF location stripped by default, owner can remove items and kick guests. Guests are
  offered "keep these photos: get Lens / sign in".
- Near-real-time: polling every 10–15 s while open (existing pattern), push to members on
  new items (FCM exists), batched.
- Privacy: the owner chooses who can see (members only), links can be turned off,
  leaving an album removes your items from it.

Success: guest upload on a phone browser in ≤ 3 taps; new items visible to others
≤ 15 s; e2e for join/add/remove/revoke/limits; abuse limits tested.

## 4. Automatic trip and event recaps

Status 2026-10-14: v1 built (detection + 8 unit tests, API, cloud film renderer tested locally,
app screens), not deployed (needs the infra deploy: Lambda + transcoder image + job role).
docs/features/recaps.md. Next: People in titles/picks ("with Asha"), best-shot scores from the
phone for picks, a push when a recap is ready, music.

- Detect trips/events on the server from metadata already uploaded: time gaps + place
  (places.ts) + distance from home; People adds who was there (on device).
- Curate: drop near-duplicates (perceptual hash of thumbnails), pick best shots
  (sharpness/faces scores computed on device at capture/import, sent as metadata).
- Recap = a suggested album + a 30–60 s video rendered in the cloud from 2048 px previews
  (not originals) with the existing Batch/ffmpeg pipeline: cheap, phone stays cool.
- Preview and approve before anything is shared; nothing auto-shared.

Success: a recap ready ≤ 10 min after a trip ends (when online); cost ≤ $0.01 per recap;
no duplicates; user can edit/approve.

## 5. Best group photo

Status 2026-10-14: v1 built. Prototype `research/groupshot/groupshot.py` (family photo, eyes
painted shut, donor shifted 11/6 px + turned 1° + 8 % brighter): face PSNR 29.5 → 41.1 dB vs the
original, seam error 1.75/255, occluded donor refused. On the phone: `imaging/GroupShot.kt` (ML
Kit landmarks + eyes-open, pairing by nose after the frames' median offset, pose guard ±10° yaw /
±8° roll) + `GroupShotMath.kt` (dense rotation × translation search without the eye band, Lab
colour match on the ring, feathered ellipse, 4-level Laplacian blend, ring-NCC guard ≥ 0.6),
4 JVM unit tests. Runs automatically after a hold-to-burst with 2+ faces when the pick has a
blink (eyes < 0.4) and another frame has them open (≥ 0.75): the fixed photo becomes the burst's
pick, every original frame stays in the burst. Not yet seen on real group bursts (needs people:
S8 walk-through). Next: smiles (not just blinks), more than eyes (mouth), on-device timing on
S8/A14, a blind A/B set.

- Input: a burst (already captured with `BurstPicker` scores per frame and face).
- Pick a base frame (sharpest, most eyes open), then for each person whose eyes are closed
  or expression is worse, take the face region from the best frame for that person,
  align (face landmarks + homography on the face region), color/lighting match, blend
  with a feathered mask (Poisson/multiband), reject when motion/occlusion is too large.
- On device first (ML Kit landmarks exist; OpenCV-style blending in Kotlin/RenderScript
  replacement via GL), cloud fallback for low-end phones only with consent.
- Research and a quality bar before release (artifacts are worse than a blink).

Success: on a test set of group bursts, ≥ 80 % of outputs rated better than the best
single frame by blind A/B, < 5 % with visible artifacts; ≤ 3 s on mid phones.

## Other high-value ideas found during the audit

- **Shot-to-shot speed is half of "fast shutter"**: the shutter waits for the JPEG write;
  fixing that helps every phone, even where ZSL isn't supported.
- **4K export codec-capacity bug** (above): fix with 1 or soon after.
