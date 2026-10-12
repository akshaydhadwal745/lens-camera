# Camera features R&D: what to add, in what order (Android first)

Status: API research done 2026-10-11; device measurement not started.
Question (user): which "expected" camera features (time-lapse, slow motion,
burst, timer, grid/level, flash and others) genuinely improve Lens, what is
technically possible across old/budget/flagship Android phones, and in what
order to build them. Rules: real value over feature count, works reliably on
old and new phones, never below original quality, automatic where possible,
graceful fallback where a phone can't do something, and the Normal camera stays
simple (creative + essentials; PRO = manual controls only, see
[features/simple-camera.md](../features/simple-camera.md)).

## What Lens already has (so not new work)

Timer (3/10 s, now in Normal), flash off/auto/on incl. screen flash for selfies,
torch in video, tap-to-focus, pinch zoom + lens chips, grid/level/histogram/
peaking (PRO), auto Night + Night mode, Portrait + styles, looks, 4K/60/HDR
video and stabilization (PRO), upload while recording.

## Findings per feature

| Feature | How on Android (API) | Reach | Quality / risk | Value for Lens users | Verdict |
|---|---|---|---|---|---|
| **Time-lapse** | No CameraX time-lapse. Options: (a) old `MediaRecorder` + `CamcorderProfile.QUALITY_TIME_LAPSE_*` + `setCaptureRate` (Camera2 stack, not CameraX); (b) **our own**: grab frames from the GL preview (or ImageCapture for 4K) at an interval and encode them with MediaCodec/Media3 at 30 fps | (b) **every phone** (we already own the frames) | Our own = full control: auto speed, exposure smoothing (no flicker), low heat (few frames). Preview-size frames (~1080p) are fine for time-lapse | High: trips and events (sunsets, crowds, roads) are exactly our audience | **Build** (phase 2) |
| **Slow motion** | CameraX 1.5+ `Recorder.getHighSpeedVideoCapabilities()` + `HighSpeedVideoSessionConfig` (experimental), 120/240 fps; `setSlowMotionEnabled(true)` saves a 30 fps file that already plays slowed | **Only phones whose maker fills the high-speed CamcorderProfiles** (Pixel, Moto Edge 30, OPPO Find N2 Flip, Xperia 1 V named by Google). Even phones whose own camera does slow-mo may report none | Real high-speed is great; fallback **60 fps → 2× slow** works on many more phones (we already record 60). Frame interpolation (cloud AI) is possible later but costly | Medium–high (fun, social) | **Build with tiers** (phase 3): 240/120 where supported → 60 fps "2× slow" → hidden |
| **Burst** | Repeated `takePicture` in MINIMIZE_LATENCY (we already have `takeBurst` in the lab) | Every phone; speed varies (measure: ~3–10 fps) | Many near-identical photos = storage/upload cost | Medium: kids, sports, pets | **Build smart** (phase 4): hold the shutter = burst, Lens picks the best frame (sharp, eyes open via on-phone face detection), keeps the rest as a stack you can expand; only the pick uploads at full priority |
| **Timer** | Done | Every phone | — | — | Keep. Later: hands-free (palm/smile) only if users ask |
| **Grid + level** | Done (PRO); GL overlay + sensor | Every phone | — | Grid is an expected basic | **Move a Grid toggle to Normal** quick settings; **smart level**: the level line appears by itself only when the phone is held almost straight (±5°), then turns yellow when level (phase 1) |
| **Flash** | Done | Every phone (screen flash for selfies) | — | — | Keep |
| **Volume-button shutter** | Key events on the camera view (volume up/down) | Every phone | none | **Expected** by most users; steadier shots | **Build** (phase 1) |
| **Focus + exposure lock, exposure slider** | CameraX `FocusMeteringAction` (lock = disable auto-cancel) + `setExposureCompensationIndex` | Every phone with AF/AE | none | **Expected** (tap, hold to lock, slide to brighten) | **Build** (phase 1) |
| **Pause / resume video** | CameraX `Recording.pause()/resume()` | Every phone (Android 7+) | none | Useful at events (one file, skip the boring parts) | **Build** (phase 1) |
| **Photo while recording** | Bind ImageCapture + VideoCapture together (device-dependent), else grab a frame from our GL preview | Most phones full-res; the rest preview-res | Fallback is lower resolution: label it, never pretend | Medium | Phase 5 |
| **Mirror selfies** | A flip in the photo's edit recipe (removable) | Every phone | none | Expected setting (text reads correctly vs as in the mirror) | Phase 1 (setting, default = as the preview looked) |
| **Location in photos** | `ImageCapture.Metadata.setLocation` / video location | Every phone with location | Privacy: opt-in, clear wording, strip on share option | High for trips (map, "where was this") | Phase 1 (opt-in on first trip-like use) |
| **Low-light boost** (video/preview in the dark) | CameraX 1.5 low light boost (Android 15+ where the HAL supports it) | Few phones today | Preview/video only | Medium | Automatic where supported (phase 3, tiny) |
| **Feature combos (HDR + 60 fps etc.)** | CameraX 1.5 Feature Group (Android 15 combination query) | Newer phones | Avoids guessing combos (our current "drop options one by one" fallback) | Quality | Use when present (phase 3, internal) |
| **Aspect ratios (4:3, 16:9, 1:1)** | Removable crop in the recipe (keeps the full original) | Every phone | none | Medium (social formats) | Phase 5 |
| **Motion photos** (short clip around each photo) | Google Motion Photo format (JPEG/HEIC + appended MP4 + XMP `Camera:MotionPhoto`); needs a rolling video buffer | Most phones | Battery/heat (always-on encoder), ~2× storage | High delight, but costly | Later (after measuring heat) |
| **Document / QR in camera** | ML Kit document scanner (Play services); barcode scanner (already in the app) | Phones with Play services / every phone | — | Tickets, receipts on trips | Later |
| **Panorama, dual camera (PiP), AR/beauty** | Custom stitching / concurrent camera (few phones) / AR libs | Low or uneven | High effort, often poor results | Low | **Skip for now** |

## Recommended order

0. **Measure first (one build, no new UI):** add feature probes to Camera info +
   the self-test: high-speed video capabilities (qualities, fps ranges), 60 fps
   per quality, time-lapse CamcorderProfiles, ImageCapture+VideoCapture binding,
   burst frames/second and memory, low-light boost, feature-group support,
   preview frame time at 1080p. Run on Firebase Test Lab across tiers (Android 8
   F01L, budget Galaxy A14 / realme / OPPO A79, mid Pixel 8a, flagship S22/S23
   Ultra, 32-bit Galaxy A10) and the user's Galaxy S8. Results → table below.
1. **Essentials (small, every phone):** volume-button shutter; tap to focus +
   hold to lock + exposure slider; pause/resume video; Grid in Normal + smart
   level; mirror-selfie setting; opt-in location.
2. **Time-lapse** (every phone, our own frame grab + encoder): one TIME-LAPSE
   mode; Lens picks the speed automatically so any recording length becomes a
   ~20–40 s clip (the longer you record, the faster it plays); exposure smoothing
   against flicker; focus/exposure locked after the first second; works with the
   screen off later (background service).
3. **Slow motion** (tiers by measured capability): SLO-MO mode shown only when
   the phone can do at least 60 fps; 120/240 fps where the maker exposes it,
   else 2× from 60 fps; the label always tells the truth (e.g. "SLO-MO 4×" / "2×").
4. **Smart burst** (hold the shutter): best-shot pick + stack in the roll.
5. Photo while recording, aspect ratios; then motion photos / document scan
   once the above is solid.

## UI rules (keep Normal simple)

- New capture types are **modes** in the existing strip (TIME-LAPSE, SLO-MO) and
  only appear if the phone supports them. Burst needs no button (hold the shutter).
- Small essentials (grid, mirror, location, volume key) live in one compact
  quick-settings sheet from the top pill; nothing technical there.
- PRO keeps manual controls only.

## Test plan for each feature (before calling it done)

- Self-test step per feature (pass/warn/fail) on Test Lab tiers + S8.
- Quality: time-lapse flicker (frame-to-frame brightness variance), slow-mo real
  fps in the file (ffprobe), burst frames/second, heat (battery temperature over
  a 5-minute time-lapse), file sizes vs upload budget.
- Fallbacks verified on the lowest tier (Android 8 / 32-bit).

## Video start delay (checklist 1.11), measured 2026-10-11

From the dev-46 Test Lab logs (CameraX Recorder: press → audio ENABLED → Muxer.start = first keyframe):

| Phone | Mic ready | First video frame | Total |
|---|---|---|---|
| Pixel 8a | 120 ms | +201 ms | 0.32 s |
| Galaxy A14 5G | 156 ms | +295 ms | 0.45 s |
| Galaxy S22 Ultra | 205 ms | +258 ms | 0.46 s |
| F01L (Android 8.1) | 146 ms | +876 ms | 1.02 s |
| OPPO A79 | 707 ms | +836 ms | 1.54 s |

Both parts start only when recording starts; CameraX has no pre-start API.
Built: honest REC (timer from the first recorded frame). Research option for
later: Lens-owned encoder with a rolling pre-roll buffer, so the saved clip can
begin before the press (same buffer as Motion Photos).

## Measured results

Firebase Test Lab self-test, dev-67, 2026-10-12 (real phones in a rack; raw
files in research/quality/out/testlab-dev-67, `scripts/testlab-summary.py`).

| Phone | Android | Slow-mo | 60 fps | Photo while recording | Burst (photos/s) | Low-light boost | Face priority | Preview stab. | Maker extensions | Longest exposure | Video start | Viewfinder fps: plain / readers / motion / Portrait / Night |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F01L (old) | 8.1 | no | 1080p | full photo stream 1080p | 1.7 | no | yes | no | none | 0.8 s | 541 ms | 24.5 / 24.5 / 24 / 24.5 / 10 |
| Galaxy A14 5G (budget) | 14 | 720p (2× fallback) | 1080p | photo stream 4080×2296 | 0.6 | no | yes | no | none | 16 s | 808 ms | 29.5 / 29.5 / 30 / 30 / 10 |
| OPPO A79 (budget) | 14 | 720p | 1080p | photo stream 3840×2160 | 0.6 | no | yes | no | none | 32 s | 1387 ms | 20 / 19.5 / 20 / 20 / 20 |
| Xiaomi 14 (flagship) | 15 | 1080p high speed | 4K | photo stream 4K | 1.9 | no | yes | yes | night, bokeh | 1.0 s+ | 315 ms | 30 / 30 / 30 / 30 / 13 |
| Galaxy S25 Ultra (flagship) | 15 | 1080p high speed | 4K | photo stream 4K | 0.5 | no | yes | yes | night, bokeh, faceRetouch | 1/6 s | 295 ms | 30 / **15 / 15.5 / 15** / 23.5 |

What it tells us:
- **Face priority (7.2) is everywhere** (5/5): no own face detection needed.
- **Low-light boost (3.6): 0/5**, even on the two Android 15 phones → the 24–30 fps auto range is what users actually get.
- **Photo while recording (3.7): full photo stream on all 5** (tier A).
- **Maker bokeh (4.6)** exists on Xiaomi 14 and S25 Ultra only → keep our own Portrait as the default.
- **Astro (9.6):** possible on 4/5; the S25 Ultra exposes only 1/6 s to apps.
- **Burst is slow with best-quality capture** on budget phones and the S25 Ultra (0.5–0.6 photos/s, first shot 2.4 s on S25 Ultra) → smart burst got 1 shot in 1.5 s. dev-68 measures the quick capture path on every phone before changing anything.
- **S25 Ultra halves the viewfinder** (30 → 15 fps) whenever a reader runs (QR + scenes, motion buffer, live Portrait); the Xiaomi 14 (similar Snapdragon) doesn't. dev-68 reports where the frame time goes.
- Play services models: present/downloaded on F01L, Xiaomi 14, S25 Ultra; timed out on A14 and OPPO within 90 s (dev-68 asks for them at app start and waits 150 s in the test).

## Sources

- CameraX 1.5 slow motion: https://developer.android.com/blog/posts/high-speed-capture-and-slow-motion-video-with-camera-x-1-5
- CameraX 1.5 release (Feature Group, low light boost, high-speed): https://developer.android.com/blog/posts/introducing-camera-x-1-5-powerful-video-recording-and-pro-level-image-capture
- CameraX video (pause/resume, use-case combinations): https://developer.android.com/media/camera/camerax/video-capture
- CamcorderProfile (time-lapse profiles): https://developer.android.com/reference/android/media/CamcorderProfile
- Motion Photo format: https://developer.android.com/media/platform/motion-photo-format
