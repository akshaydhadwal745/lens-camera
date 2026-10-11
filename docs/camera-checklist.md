# Lens camera: master checklist

The single list of every camera feature Lens should support, in the order we
work on them. **Strictly one feature at a time**: a feature is finished and
validated before the next one starts (user, 2026-10-11). Android first; every
phone, from old budget to new flagship, through intelligent adaptation.

Updated: 2026-10-11.

## Status legend

| Mark | Meaning |
|---|---|
| ✅ | **Validated**: works, with evidence (real phone and/or Test Lab results, linked) |
| 🟡 | **Built, not validated**: code exists, no real-device evidence yet. Not "done" |
| 🔨 | **In progress** (only one feature at a time) |
| ⬜ | Pending |
| ⛔ | Not doing (reason given) |

Never ✅ without evidence; never claim "works on every phone" without results
from each device category below.

## How every feature is done (the loop)

1. **Research:** Android/CameraX/Camera2 APIs, hardware limits, what the stock
   cameras do, what fails on old phones. Written in `docs/research/`.
2. **Measure reach:** a probe/self-test step reports what each phone can do
   (Camera info + self-test + diagnostics).
3. **Design:** the automatic default for the Normal camera, the fallback chain
   for phones without native support (software processing, cloud, a lower
   tier with an honest label), and only genuine manual controls in PRO.
4. **Build** with a self-test step for the feature.
5. **Test** across the device categories (below): automated (Test Lab
   self-test, emulator UI at 360 dp) + real shots (Galaxy S8) + quality metrics
   where they apply. Record results and limitations here.
6. **Validate → ✅**, document in `docs/features/`, then start the next feature.

## Device categories (test matrix)

| Category | Real phone | Firebase Test Lab (physical) | Notes |
|---|---|---|---|
| Old (Android 8–9) | **Galaxy S8** (Android 9, the user's) | F01L (Android 8.1) | Mali GPU, Camera2 FULL back camera |
| Budget | — | Galaxy A14 5G, OPPO A79, realme C53 (low capacity) | |
| 32-bit only | — | Galaxy A10, TECNO POP 7 | `Lens-32bit.apk` |
| Mid | — | Pixel 8a, moto edge 30 | |
| Flagship | — | Galaxy S22 / S23 Ultra, Pixel 9 Pro | |
| UI layout | Emulator 360 dp (S8 width) + landscape | | arm64 APK repacked for x86_64 |

Limits of the matrix: Test Lab phones can't film real scenes or people (they
validate capability, speed, crashes, heat), so image quality is judged on real
shots (S8 now; more phones later) with blind A/B against the stock camera.
5 physical Test Lab runs per day (free tier).

## The list (work order)

### 0. Finish what's in progress

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 0.1 | **dev-46 batch** (commit 139a40f): alignment pass (all screens), Normal/PRO restructure (creative in Normal, manual in PRO), mode-strip tap fix, live Portrait blur + "No person found", Portrait styles (Natural/Studio/Mono/Stage), Night viewfinder preview | ✅ | Done: CI all green (Android 64/32-bit, iOS), `verify-release 46` 4/4, Kotlin unit tests 32/32, 7 shaders pass Khronos glslang, Test Lab self-test on 5 tiers (no regressions; see log), emulator 360 dp: Normal/PRO layout, mode switching, style chips, "No person found" notice, Night mode draws without GL errors. **Not yet proven (needs the S8):** live blur with a real person, styles on a person, Night preview brightness/grain in the dark, Portrait smoothness + heat (emulator too slow to judge: ML runs through ARM translation). **S8: user reported "no problem" (2026-10-11) → validated.** |

### 1. Measurement + core capture reliability (every phone first)

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 1.1 | **Capability probes** for all planned features: per camera slow motion (CameraX + Camera2), max video fps at 1080p/4K, photo while recording, maker time-lapse profiles, low-light boost, stabilization, zero shutter lag; video encoders; self-test: preview fps (Photo vs live Portrait/Night), video start delay, burst speed; Test Lab result carries the full report; Camera info shows it | 🔨 | Built (`FeatureProbe.kt`, self-test steps, Camera info). APIs checked against the CameraX 1.6 jars. dev-47: verify-release 4/4, virtual Test Lab ✓ (see log), 2 probe gaps + 1 title bug fixed in dev-48. **Next: dev-48 on physical tiers (F01L, A14, OPPO A79, Pixel 8a, S22 Ultra; Galaxy A10 32-bit) when the daily Test Lab quota resets, + S8 Camera info report**, then fill the measured table in research/camera-features.md. Anonymous field survey still needs a privacy-policy line + user OK |
| 1.2 | Viewfinder: correct orientation in all 6 positions, front/back | 🟡 | S8 fixed in dev-30 (user saw it); 180° fix dev-37 passed Test Lab emulators; not re-checked on S8 since |
| 1.3 | Full-resolution photos | ✅ | S8: 4032×3024 with Samsung MakerNote (cloud, 2026-10-11 08:26); Galaxy S24 + realme C53 100 % (Test Lab dev-35). Pixel 8a: 16 MP not offered with preview (explained) |
| 1.4 | Tap to focus | 🟡 | Mapping fixed dev-31; not confirmed by eye |
| 1.5 | Zoom + lens switching (0.6×/1×/2×) | 🟡 | Self-test covers lenses; S8 has one back lens |
| 1.6 | Flash off/auto/on + selfie screen flash | 🟡 | Built dev-40; not seen on a phone |
| 1.7 | Automatic HDR (Ultra HDR where supported) | 🟡 | Default on; not measured |
| 1.8 | Night: auto Night + Night mode (Lens merge / maker extension) | 🟡 | Merge validated only synthetically (≈4× less noise); thresholds a first guess |
| 1.9 | Photo quality pipeline by capability tier (single frame → burst merge → maker extensions; cloud later) | ⬜ | Plan: docs/research/camera-quality.md; Quality Lab built, waiting for S8 lab sets |
| 1.10 | Heat / battery adaptation | 🟡 | Thermal guard built (fewer frames, uploads pause); not measured |
| 1.11 | **Video start delay**: recording only begins when the mic is ready and the encoder's first keyframe arrives | 🔨 | **Measured (dev-46 logs):** Pixel 8a 0.32 s, Galaxy A14 0.45 s, S22 Ultra 0.46 s, Android 8.1 F01L 1.02 s, OPPO A79 1.54 s (mic 0.71 s + first frame 0.84 s). CameraX starts both only on record (no API to pre-start). **Built (A, every phone):** native `onRecordingStarted` at the first recorded data; camera shows grey dot + "Starting…" until then, REC + timer from real 0:00; self-test warns > 700 ms. **Later R&D (B):** own encoder + ~1.5 s rolling buffer so the clip starts *before* the press (shares the Motion Photos buffer, 9). To validate tomorrow: S8 + tiers, the timer matches the saved clip length |
| 1.12 | Dependency security alerts (GitHub Dependabot: 2 high, 3 moderate on main) | 🔨 | Reviewed 2026-10-11 (`npm ls` per package). **Ships to users: only `decode-uri-component` 0.2.2** (expo-router → query-string; link parsing DoS on malformed `%` input). 0.5.0 is ESM-only and query-string 7 `require()`s it, so the 0.5.0 linear decoder is ported as `patches/decode-uri-component+0.2.2.patch`: 20 000/20 000 random inputs identical to 0.2.2, attack input 0.1 ms flat (original 33→63 ms and growing), confirmed in the Android bundle. **Build/dev tools only (not in the app or Lambda):** braces (patch-package), node-forge (Expo CLI / code-signing helper; our OTA signing + verify-release use Node crypto), uuid (ngrok, Xcode plugin), brace-expansion (CDK synth). Validate: app links open on S8 after the next build; then close #5 with the patch and dismiss the 4 build-only alerts with reasons (user OK). Never merge Dependabot PR #1 (expo-router v58) |

### 2. Essentials everyone expects

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 2.1 | Focus + exposure lock (hold) and exposure slider | 🔨 | Built (dev-50): tap = focus+expose (5 s auto-cancel) + sun slider; drag up/down = exposure compensation in Normal and PRO (150 dp/EV, clamped to the camera's range, haptic at 0), reset on a new tap / mode / camera; long-press = lock (no auto-cancel + Camera2 `CONTROL_AE_LOCK` after metering settles), badge says what the camera could hold (AE/AF, AE: fixed-focus, AF: no AE lock), tap unlocks. Emulator: tap box + sun ✓, drag → +0.4 EV for 66 dp ✓ (dev-48 native + new JS). To validate: lock on dev-50 (emulator + S8), exposure visibly changes, lock holds when pointing at a bright window, fixed-focus front camera shows "AE LOCK" |
| 2.2 | Volume-button shutter | 🔨 | Built: volume up/down + camera key (and Bluetooth selfie remotes, which send volume up) act as the shutter (photo / start-stop video / cancel timer) while the main camera is on screen and active; repeats ignored; key consumed only then (volume normal elsewhere). Window.Callback wrapped by delegation while attached, restored on detach (`HardwareShutter.kt`). To validate: emulator `adb shell input keyevent KEYCODE_VOLUME_DOWN` (photo taken, volume unchanged), gallery screen volume still works; S8 buttons + a selfie remote if available |
| 2.3 | Timer (3/10 s) | 🟡 | Now in Normal (dev-46) |
| 2.4 | Grid in Normal + smart level (shows when nearly straight) | 🔨 | Built (JS): Settings → Camera → **Grid** switch (rule of thirds in Normal, off by default; PRO keeps its own grid choice); Normal gets a **smart level**: the line appears only within 8° of straight, turns yellow when level, fades 1.5 s after (hidden at a deliberate tilt); PRO keeps the always-on level toggle. To validate: emulator (grid toggle reaches the camera, level with emulated tilt) + S8 |
| 2.5 | Mirror selfie setting | 🔨 | Research: CameraX 1.6 flips a saved photo only when `Metadata.setReversedHorizontal` is set (checked in the jar: `FileUtil` → `Exif.flipHorizontally`); Lens never set it → selfies were saved un-mirrored while the preview is mirrored. Built: Settings → Camera → **Mirror selfies** (on by default = as previewed, like Samsung); photos: lossless EXIF flip (pixels untouched; Glide/expo-image, our renderer and browsers apply all 8 EXIF orientations); video: `VideoCapture.setMirrorMode(MIRROR_MODE_ON_FRONT_ONLY)` (camera pipeline, no cost); off = true-to-life. To validate: S8 selfie with text in view, on and off, photo + video, thumbnails + viewer + web |
| 2.6 | Location in photos/videos (opt-in) | 🔨 | Built: Settings → Camera → **Save location** (off by default; asks for location permission when switched on, stays off if refused; note says shared photos keep it). `LocationTracker.kt`: Android LocationManager (GPS + network, no Play services), listens only while the camera is on screen (≤ every 5 s / 10 m), never writes a fix older than 10 min. Photos: `ImageCapture.Metadata.setLocation` (EXIF GPS); videos: `FileOutputOptions.setLocation`; Night merge now copies the GPS tags (it dropped them); Portrait and editor exports already keep EXIF GPS. Privacy policy already covers location in photo metadata. New app permissions ACCESS_FINE/COARSE_LOCATION (app.json). To validate: emulator `adb emu geo fix` → photo EXIF GPS (root), Night photo keeps it; S8 outdoors; web/viewer shows place (later) |
| 2.7 | Shutter feedback: haptic, sound setting, instant thumbnail | 🔨 | Haptic + flash animation (built before). Thumbnail is already instant for photos (shows the saved original before the 400 px thumb exists). **New:** system camera sounds via `MediaActionSound` (`ShutterSound.kt`): click at CameraX `onCaptureStarted` (the real start, not the press), one click per Night burst, record start (before the mic opens, so it isn't recorded) / stop (after the file closes); Settings → Camera → **Shutter sound** (on by default); silent/vibrate mutes it, except where the law requires a shutter sound (`MediaActionSound.mustPlayShutterSound()`, Android 13+). To validate: S8 sound on/off, silent mode, video beep not in the clip |

### 3. Video

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 3.1 | 1080p/4K, 30/60 fps, stabilization, HDR video (automatic in Normal, choices in PRO) | 🟡 | Self-test records 3 s; quality not measured |
| 3.2 | Upload while recording | ✅ | S8 (2026-10-10) |
| 3.3 | Pause / resume recording | 🔨 | Built: CameraX `Recording.pause()/resume()` (one file, paused time not recorded; checked in the 1.6 jar). While recording, the flip button's spot becomes ⏸ / ⏺ (enabled once frames flow); the REC pill shows `0:12 · PAUSED` with a yellow dot and the timer stops. Upload-while-recording is safe (it only uploads finished blocks; no stall timeout). To validate: S8 + emulator: pause 5 s → saved clip length = timer, no frozen frames, audio in sync |
| 3.4 | Time-lapse (auto speed, deflicker, every phone via own frame grab + encoder) | 🔨 | Built: TIME-LAPSE mode (left of VIDEO), offered only where the GPU viewfinder can feed a video encoder (recordable EGL config; else hidden). Frames from the viewfinder (same rotation code as the preview, cropped to 16:9 in the held orientation, long side = camera buffer ≤ 1920, preview bound 16:9 in this mode) → `TimeLapseEncoder` (MediaCodec H.264 + MediaMuxer, 30 fps, no audio, I-frame every 1 s, high bitrate). Automatic speed: 0.5 s interval for the first minute (15×), 1 s to 5 min (30×), 2 s to 20 min (60×), 4 s after (120×) → 10 min ≈ 17 s clip. Deflicker: each frame's gain pulled toward the running mean brightness (±15 %). REC shows `2:14 → 0:07`. Saves as a video (look = removable edit). To validate: emulator (mode shows, clip plays, length matches), S8 5-min clip: flicker, heat, orientation landscape/portrait, front camera |
| 3.5 | Slow motion (120/240 fps where exposed → 60 fps 2× → hidden; maybe interpolation later) | 🔨 | Built: SLO-MO mode, offered only where the camera can (capability `slowMotionFactor`). Tier A: CameraX `HighSpeedVideoSessionConfig` (no opt-in in 1.6), FHD/HD, 240 fps preferred else fastest ≥ 120 → 30 fps file that already plays slowed (8×/4×), preview + video only. Tier B: bind 60 fps, record, then `SlowMotion.retime` copies the samples with timestamps × 2 (no re-encode, lossless) → 2× slow. Silent (no audio track), torch works. REC shows `0:05 · 4× SLOW`. Self-test steps added: slow motion (clip ≈ 3 s × factor) and time-lapse (≥ 6 frames in 6 s). To validate: Test Lab tiers (which tier each phone gets), S8 (60 fps → 2×), playback smoothness, orientation |
| 3.6 | Low-light video (low-light boost where supported, else tuned AE) | 🔨 | Built (Normal video only; PRO keeps its fixed fps): 24–30 fps auto-exposure range where the camera offers it (≈ 25 % more light per frame in the dark; VFR file, players + our transcoder handle it), and CameraX `enableLowLightBoostAsync` where `isLowLightBoostSupported` (Android 15+ HALs; 30 fps SDR only, as CameraX requires). REC shows `· LOW LIGHT` while the boost is ACTIVE (`lowLightBoostState`). Reach measured by 1.1 probe `lowLightBoost`. To validate: S8 dark-room video Normal vs PRO (brightness, noise, frame rate in ffprobe); Test Lab Android 15/16 phones for the boost |
| 3.7 | Photo while recording | 🔨 | Built: while recording, the gallery spot becomes a white photo button. Tier A: a full-resolution JPEG `ImageCapture` (16:9, highest) bound next to the video only where `isSessionConfigSupported(preview + video + photo)`; extra last bind attempt without it so a phone that over-claims still records. Tier B: the current camera frame from the GPU viewfinder (16:9 upright, stream resolution, never upscaled, JPEG 95, EXIF date). Self-test video step now takes one and reports `videoPhoto` (size + which tier). To validate: Test Lab tiers (which tier each phone gets) + S8 |
| 3.8 | Audio quality (wind, external/Bluetooth mic) | 🔨 | Research (CameraX 1.6 jar): `Recorder.Builder.setAudioSource` exists; the default `CAMCORDER` source is the one phone makers tune for their own camera (their noise/wind processing) → kept; no public wind-noise API on Android. Wired/USB mics are routed automatically; Bluetooth mics use the call profile (8–16 kHz, worse than the built-in mic) → deliberately not used. **Built:** recording sound health from `AudioStats`: the REC pill shows **NO SOUND** the moment the mic is silenced (Android 12+ mic privacy toggle, another app holding it) or fails, so a silent video never goes unnoticed; `· EXT MIC` when a wired/USB mic records. To validate: S8 with mic toggle off (Android 9 has none: test by another app recording), wired headset |

### 4. Portrait

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 4.1 | Person mask in the photo + blur as an edit | ✅ | S8 selfies 2026-10-10: mask correct and aligned, blurred preview (cloud) |
| 4.2 | Live blur in viewfinder, styles, "No person found" | 🔨 | In 0.1 |
| 4.3 | Edge refinement (hair), realistic disc bokeh, edge-aware compositing | 🔨 | Prototyped on the user's real S8 portraits (research/portrait.md: halo −0.043 → −0.009, ring ghosts gone, hair outline follows hair). Built: capture-time guided-filter refinement in a 1.5 % trimap band, mask stored at 768 px (20–29 KB); renderer 64-tap golden-angle disc, highlight-weighted, background-only taps, radius = fraction of the long side (2.2 % at f/2.8; previews now match exports); tile margin = blur reach; live viewfinder same mapping. Unit tests 34/34 (new: guided filter sharpens a soft mask onto the photo edge; blur mapping). To validate: new S8 portraits (hair, glasses, busy background), export time on S8 for 12 MP, editor live preview speed |
| 4.4 | Automatic blur strength (subject size/distance) | 🔨 | Built (Normal camera; PRO keeps its f-number): like a real lens, the more of the frame the person fills, the shallower the depth of field: coverage ≥ 55 % → f/1.8, 30 % → f/2.8, 12 % → f/4, smaller → f/5.6 (linear between; `PortraitStyle.autoAperture`). Photo: from the capture mask coverage, saved in the recipe (editable later); live viewfinder: from the smoothed live coverage, same mapping. Unit test (mapping + monotonic). To validate: S8 close-up vs half-body vs full-body portraits look natural |
| 4.5 | Pets/objects (ML Kit subject segmentation where Play services exist) | 🔨 | Built: when the person model finds nobody, Portrait tries ML Kit subject segmentation (`play-services-mlkit-subject-segmentation:16.0.0-beta1`, ~200 KB, model via Play services, install-time download meta-data `subject_segment`; beta API → every failure = "no subject"). Accepts a subject covering 2–90 % of the frame; same refinement + auto blur; recipe `depthKind: subject`; notice "Portrait applied to the subject". Phones without Play services: people only (as before). Limitation: the live viewfinder blur stays people-only (the subject model is too heavy for live on budget phones). To validate: S8 photo of a pet/object (Play services present), self-test portrait step on Test Lab (racks may now find a subject) |
| 4.6 | Maker bokeh extension where offered; depth-graded blur (depth / cloud) | ⬜ deferred | Deliberately not built yet: maker bokeh bakes the blur into the photo (breaks removable edits + our styles), and its reach is unknown until the 1.1 probes report `extensions: bokeh` per phone (test day). Depth-graded blur needs a depth model: too heavy on-phone → cloud R&D later |

### 5. Looks (filters)

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 5.1 | 13 looks, live in viewfinder, strength, removable edit | 🟡 | Exact iOS LUTs; now in Normal (dev-46) |
| 5.2 | Video looks (recording + playback + export) | ✅ | Playback with look: user confirmed on S8 (dev-45, 2026-10-11) |
| 5.3 | Smart look suggestion (scene-aware, one tap) | 🔨 | Built (Normal camera, no look chosen, Photo/Video): every 1.5 s the ~320 px viewfinder copy → ML Kit image labeling (Play services, ~200 KB, install-time `ica`) → labels ≥ 70 % → look (sunset → Golden hour, food → Warm, snow → Cool, night → Cinematic, flowers/beach/mountains/sky → Vivid); must repeat twice before it shows; a yellow-outlined "✦ Golden hour" chip at the front of the looks row, one tap applies (never automatic). No Play services → no suggestion. Unit test for the mapping (36/36). To validate: S8 outdoors (sunset, food, plants), check it doesn't flicker or heat |

### 6. Editing

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 6.1 | Photo editor: auto, light/colour, crop/rotate/straighten, portrait, copy/paste | 🟡 | 1024 px tiles for big photos; not tested on big photos on a phone |
| 6.2 | Video trim | 🔨 | Built as a removable edit (recipe `trim: {start, end}`; the original stays whole, change or remove it any time): player ✂ tool (own videos) → the timeline's nearer handle follows the finger, frame preview, ≥ 0.5 s, Cancel / Save; playback starts at the trim start, stops at the end, seeks stay inside. Save/Share export through Media3 `ClippingConfiguration`; trim-only (no look) uses `experimentalSetTrimOptimizationEnabled` (re-encodes only up to the first key frame); a trim alone skips the look shader in playback and posters. Limitations: the web player plays the whole video; HLS streams aren't clipped (playback is). To validate: S8 trim + save to gallery (duration with ffprobe), share, playback stops at the end |
| 6.3 | Non-destructive edits everywhere (original kept) | ✅ | By design; recipe stored separately |

### 7. Intelligent enhancements

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 7.1 | Scene-aware automatic decisions (Night, HDR, frame counts) from measured data | ⬜ | Depends on 1.9 |
| 7.2 | Face-aware exposure / focus | 🔨 | Built (Normal camera, auto exposure, not Night, not while long-press locked): Camera2 `CONTROL_SCENE_MODE_FACE_PRIORITY` where the camera lists it (`CONTROL_AVAILABLE_SCENE_MODES`): the camera's own face detection steers AE/AF/AWB (no ML, no heat; 3A modes, EV and tap-to-focus keep working per the Camera2 spec). Reach added to the 1.1 probes (`facePriority`). If test day shows low reach: fallback = our own face detection → metering points. To validate: S8 backlit face (window behind) Normal vs PRO |
| 7.3 | Smart burst (hold shutter, best shot, stack) | ⬜ | |
| 7.4 | Auto straighten / horizon | ⬜ | |

### 8. PRO (manual controls only)

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 8.1 | Manual ISO / shutter / WB / focus / EV dials | 🟡 | S8 manual exposure available |
| 8.2 | RAW (DNG) | 🟡 | Develop path untested |
| 8.3 | Monitoring: histogram, peaking, zebra, false colour, level, grid; presets | 🟡 | |

### 9. Later (after everything above)

Motion photos; document scanning; QR in camera; aspect ratios; hyperlapse;
astro mode; iPhone parity for Android-first features.

### ⛔ Not doing (for now)

Panorama, dual-camera picture-in-picture, AR/beauty face reshaping: high
effort, uneven or poor results across phones, low value for our users.

## Test results log

| Date | Build | Feature | Device(s) | Result |
|---|---|---|---|---|
| 2026-10-10 | dev-35 | 1.3 full-res | Galaxy S24, realme C53 (Test Lab) | 100 % of max size |
| 2026-10-10 | dev-36/37 | self-test | Galaxy A14, Pixel 8a, emulators 14/15/16 | pass (Pixel 8a warnings explained) |
| 2026-10-11 | dev-45 | 1.3 full-res | Galaxy S8 | 4032×3024, untouched HAL JPEG |
| 2026-10-11 | dev-45 | 5.2 video looks playback | Galaxy S8 | user: working |
| 2026-10-11 | — | 4.1 portrait mask | Galaxy S8 (2 selfies) | mask correct, preview blurred |
| 2026-10-11 | dev-46 | release | CI | verify-release 4/4 (runtime n-bd085ac9189bfafe54c9) |
| 2026-10-11 | dev-46 | self-test | F01L Android 8.1 (old) | 13 pass, 1 warn (portrait: no person in view, expected) |
| 2026-10-11 | dev-46 | self-test | Galaxy A14 (budget) | 13 pass, 1 warn (portrait, expected) |
| 2026-10-11 | dev-46 | self-test | OPPO A79 (budget) | 12 pass, 1 warn (portrait), **1 fail: video 1.84 s of 3 s** → 1.11 |
| 2026-10-11 | dev-46 | self-test | Pixel 8a (mid) | 6 pass, 11 warn: known (16 MP not offered with preview; maker Night 5 MP) |
| 2026-10-11 | dev-46 | self-test | Galaxy S22 Ultra (flagship) | 18 pass, 1 warn (portrait, expected) |
| 2026-10-11 | dev-47 | 1.1 probes | Test Lab virtual Android 14/15/16 | 14 pass + 1 expected portrait warn each; result files carry the camera report + feature probes; preview fps Photo 18.5–20 / Portrait 17.5–18 (live Portrait costs ~0.5 fps) / Night 7.5–8 (Night lets exposure run slower, plus the averaging: re-measure on real phones) / Video 26.5–27; video start delay 371–473 ms; burst 0.7 photos/s (virtual). Gaps found → fixed in dev-48: encoders reported "none" when only software encoders exist; fps/photo-in-video only probed 1080p/4K |
| 2026-10-11 | dev-47 | 1.1 Camera info | Emulator 360 dp | probes render in plain words; title "Camera info" wrapped onto a hidden line → fixed (dev-48) |
| 2026-10-11 | dev-51 | release | CI | verify-release 51 4/4 (runtime n-d0fecd73f7e5763cc670); dev-48/49/50 also 4/4 |
| 2026-10-11 | dev-51 | 2.2 volume keys | Emulator | volume-down → photo taken (`takePictureInternal`), no system volume pop-up (key consumed) ✓ |
| 2026-10-11 | dev-51 | 2.1 lock | Emulator | long-press → badge "AF LOCK" (virtual camera has no AE lock → honest fallback label), box stays; tap unlocks + refocuses, box fades after 3 s ✓. Drag-to-brighten registers (+0.78 EV / 117 dp); visible brightness needs a real camera |
| 2026-10-11 | dev-52, dev-53, dev-54 | release | CI | verify-release 4/4 each (dev-54 = 3.4 time-lapse, 3.5 slow motion, 3.6 low-light video) |
| 2026-10-11 | dev-54 | 3.4 time-lapse | Emulator | TIME-LAPSE in the mode strip ✓ (SLO-MO correctly hidden: virtual camera max 30 fps); 20 s run → H.264 720×1280 (= preview buffer, held portrait), 30 fps, 22 frames, 0.73 s ✓ (emulator draws ~18 fps so some 0.5 s slots were missed; real phones to confirm). Bug found → fixed: REC showed the video "4K" badge in time-lapse |
| 2026-10-11 | dev-53 | 2.4–2.7 Settings | Emulator 360 dp | Camera card: Grid, Mirror selfies, Save location (with note), Shutter sound, Camera info — aligned, icons, toggles work ✓ |
| 2026-10-11 | dev-53 | 2.6 location | Emulator | photo EXIF GPS 39°14'14.1"N 123°9'0.1"W = the device's live GPS fix (39.237255, −123.150032) exactly ✓ |
| 2026-10-11 | dev-53 | 3.3 pause | Emulator | 8 s rec + 8 s paused + 8 s rec → 16.8 s clip ✓; REC pill `0:16 · PAUSED` yellow, resume button in the flip spot ✓ |
| 2026-10-11 | dev-46 | UI | Emulator 360 dp | Normal/PRO layout, modes, styles, "No person found", Night draws; live blur with a person not testable (virtual camera can't be aimed headless) |
