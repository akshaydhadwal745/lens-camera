# Camera self-test (Android)

One automated pass through everything the camera does on this phone, with a
pass/fail per step. Runs:

- **On any phone:** Settings → Camera info → Run self-test (about a minute;
  rotates the screen to landscape and back; test photos are deleted).
- **On real phones in Firebase Test Lab** as a "game loop": Test Lab launches
  Lens with `com.google.intent.action.TEST_LOOP` (intent filter added by
  `plugins/with-test-loop.js`); `src/app/index.tsx` redirects to `/selftest`,
  which runs, writes Test Lab's result file, sends the report and closes.
  `scripts/testlab.sh <build> [model/version …]` starts it and prints every
  phone's result (32-bit phones: `model/version:32` uses Lens-32bit.apk).

## Steps (`src/lib/self-test.ts`, planned from the phone's capabilities)

| Step | Pass when |
|---|---|
| Back camera photo | photo saved; ≥ 90 % of the largest JPEG = pass, 50–90 % = warn (e.g. Pixel 8a keeps 12 of 16 MP: 16 MP isn't guaranteed with a live preview), < 50 % = fail (the S8 bug: 1.5 of 12 MP). Maker modes only warn (their own sizes). **dev-67:** the file is inspected: Ultra HDR on but no gain map = warn |
| Landscape / other landscape / back to portrait | preview re-binds for the forced screen rotation (`targetRotation` 1/3, then 0), photo still full size |
| Flash photo (phones with a flash) | photo with flash forced on saves, full size |
| Every other back lens (0.6×, 2×…) | photo full size for that lens |
| Front camera photo | full size; **dev-67:** saved with the mirror flag (EXIF orientation 2/4/5/7, Mirror selfies on = as previewed), else warn |
| Selfie flash photo, front landscape | front photo with flash on (screen flash on phones without a front flash) completes, full size; landscape preview path |
| Normal camera readers (dev-67) | viewfinder fps with the QR + scene-label readers on (as in the Normal camera) vs the plain back camera; more than 25 % slower = warn |
| Motion photo (dev-67, phones that offer it) | photo saved with the motion clip, XMP present, clip ≥ 2 s and ≥ 15 fps (real frames counted), viewfinder ≤ 25 % slower with MOTION on; "turned itself off" (encoder too slow) = warn |
| Night | merged photo saved (4 frames), full size |
| Astro reach (dev-67) | longest manual exposure ≥ ½ s = astro possible (the plan itself needs real darkness); else skip with the reason |
| Portrait | photo saved; no mask = warn (needs a person in view; test-rack phones see none) |
| Video (3 s) | file > 0 bytes, duration ≥ 2 s; start delay > 700 ms = warn; photo while recording (which tier, size); **dev-67:** real frames/fps, size, rotation and sound from the file: no sound track or < 20 fps = warn |
| Video trim + look export (dev-67) | the 3 s clip trimmed to 0.5–2.0 s with a look through Media3: 1.5 s ± 0.4 s, export time |
| Pause and resume (dev-67) | 1.5 s + 2 s paused + 1.5 s → a clip of 2–4.2 s (the pause left out) |
| Slow motion (3 s) / Time-lapse (6 s) | where offered: slowed clip length / ≥ 6 frames; dev-67 adds the file's real frames and fps |
| Burst speed (5 shots) | 5 photos back to back; reports photos/second |
| Shutter speed (dev-68) | 3 photos each: Ultra HDR (where offered), plain JPEG, quick capture; press → saved ms; the user's default path over 1 s = warn. Every photo step also records `captureMs` |
| Smart burst + best-shot pick (dev-67) | hold for 1.5 s → shots, then the on-phone pick; pick slower than 4 s = warn |
| RAW | DNG saved (phones with RAW) |
| Plain JPEG | phones without Ultra HDR |
| Maker AUTO / HDR / NIGHT | binds and saves (skipped where the phone lacks it) |
| Editor: full-size edited photo (dev-67) | the back photo rendered at full size with a look, light/colour and a 2.1° straighten (+ portrait blur when a mask was found); slower than 8 s = warn |
| Play services models (dev-67) | document scanner, scene labels, subjects (pets/objects), faces: present / downloaded (up to 90 s) / missing; no Play services = warn |
| Upload (Test Lab only) | photo confirmed in the cloud through the real upload queue within 2 min; a hot phone pauses uploads by design (warn, dev-68) |
| Heat after the test (dev-67) | PowerManager thermal status at the start and end (Android 10+); severe or worse = warn |

Back photo, Normal camera readers, Motion photo, Portrait (live blur on), Night (night preview on) and Video also record
the **viewfinder frame rate** over 2 s (`previewFps`), so the cost of the live
Portrait/Night previews is measured per phone. dev-68 adds `previewStats`:
frames the camera delivered vs frames shown, and the average GL time per frame
in the whole draw, the frame readers, the screen swap and the motion encoder
(plus the slowest draw), so a slow viewfinder shows where its time goes. The Test Lab result file also
carries the full camera report (`device`) including the **feature probes**
(slow motion, 60 fps, photo while recording, maker time-lapse profiles,
low-light boost, stabilization, zero shutter lag, video encoders; checklist 1.1).
The anonymous diagnostics upload leaves the camera report out (≤ 32 KB limit).

Photo orientation itself follows the motion sensor, which a phone in a test
rack doesn't change, so the rotation steps check the preview path; Test Lab's
screen video shows how it looks.

Each report also goes to `POST /v1/diagnostics` as a `selftest` event
(`research/diagnostics.py` lists them).

**Reading Test Lab results:** `scripts/testlab-summary.py <results dir>` (run
automatically by `testlab.sh`) prints every phone's steps, the probe line for
docs/research/camera-features.md "Measured results", and any Lens crash
(FATAL EXCEPTION / native signal) or freeze (ANR) found in its logcat.
`TYPE=robo scripts/testlab.sh N <virtual phones>` crawls the real app screens
(the self-test uses its own screen) for crashes.

Native hooks for the dev-67 checks (LensImaging): `inspectPhoto(uri)` (EXIF
orientation/mirror, GPS, Ultra HDR gain map + MPF, motion XMP, MakerNote),
`mediaInfo(uri)` (MediaExtractor: duration, real frame count and fps, size,
rotation, codec, sound), `mlModules(install, timeoutMs)` (ModuleInstall).

Native hooks (lens-device): `testLoop()`, `writeTestResult(uri, text)`,
`finishTestLoop()`, `setOrientation(portrait | landscape | reverseLandscape | auto)`.

## Results

- **dev-36, 2026-10-10** (Test Lab game loop, matrix-gdecru8i9rs2a): Galaxy A14 5G
  11/12, emulators 11/12 and 10/12, Pixel 8a 5/15. Real bug found: on Android 14
  the display listener doesn't fire for a direct 180° turn, so the preview stayed
  on the old rotation (fixed in dev-37: rotation re-checked every 250 ms). The
  other failures were grading (portrait mask without a person, Pixel 16 MP limit,
  maker-mode sizes), now warnings.
- **dev-37, 2026-10-10** (emulators Android 14/15/16): all **11 pass, 0 fail**
  (1 warning each: portrait without a person). The Android 14 180° step that
  failed on dev-36 now passes. Real phones next.
