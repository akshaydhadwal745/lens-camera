# Lens camera: master checklist

The single list of every camera feature Lens should support, in the order we
work on them. **Strictly one feature at a time**: a feature is finished and
validated before the next one starts (user, 2026-10-11). Android first; every
phone, from old budget to new flagship, through intelligent adaptation.

Updated: 2026-10-11 (night).

## Current status (2026-10-11 night)

| | Count | Items |
|---|---|---|
| ✅ Validated | 6 | 0.1, 1.3, 3.2, 4.1, 5.2, 6.3 |
| 🟡 Built, waiting for real-phone tests | 44 | 1.1, 1.2, 1.4–1.8, 1.10–1.12 · 2.1–2.7 · 3.1, 3.3–3.8 · 4.2–4.5 · 5.1, 5.3 · 6.1, 6.2 · 7.2–7.4 · 8.1–8.3 · 9.1–9.6 |
| 🔨 In progress | 0 | Section 9 built; next is test day |
| ⬜ Pending | 3 | 1.9 (needs Quality Lab sets), 7.1 (needs test-day data), 4.6 (deferred) |

**Builds:** dev-53…56 green (verify-release 4/4). dev-57 failed (ML Kit
manifest merge) → fixed in e3ab356; dev-58/59 cancelled (superseded). dev-60
(fcbd32c: 4.3–4.5, 5.3, 6.2, 7.2, 7.3 + the fix) verify-release 4/4. dev-61
(6f58ce6: + 7.4 auto-straighten, 9.1 aspect ratios) verify-release 4/4. dev-62
(9.2 motion photos), dev-63 (9.3 QR), dev-64 (motion fixes), dev-65 (9.4 scan, 9.5 hyperlapse) 4/4.
dev-66 (187c683: 9.6 astro + motion auto-off) verify-release 4/4 = **test-day build** (runtime n-09b93dc58996f20ab0e5).

**Next (2026-10-12, S8 not available → Firebase first):** the self-test was
extended so Test Lab checks every item a rack phone can (dev-67: Normal camera
readers fps, motion photo clip fps, selfie mirror flag, Ultra HDR gain map,
astro reach, pause/resume, trim + look export, editor render time, smart burst
pick, Play services models, real video fps/sound, heat; `scripts/testlab-summary.py`
adds logcat crash/ANR scan + probe lines; `TYPE=robo` crawls the real screens).
Day 1 physical: F01L/27, a14xm/34, OP573DL1/34, houji/35 (Xiaomi 14), pa3q/35
(S25 Ultra) + Robo on virtual MediumPhone.arm/35, /36. Day 2: a10/29:32,
TECNO-BF6/31:32, frankel/36 (Pixel 10), dubai/34, XQ-DC54/34. Items only a real
phone in a real scene can prove (image quality, person/pet portrait, dark Night,
QR, scan UI, hyperlapse walk, astro tripod, location, keys, sound) stay 🟡 for
the S8. ✅ only with evidence; failures are fixed before moving on.

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
| 1.1 | **Capability probes** for all planned features: per camera slow motion (CameraX + Camera2), max video fps at 1080p/4K, photo while recording, maker time-lapse profiles, low-light boost, stabilization, zero shutter lag; video encoders; self-test: preview fps (Photo vs live Portrait/Night), video start delay, burst speed; Test Lab result carries the full report; Camera info shows it | 🟡 | Built (`FeatureProbe.kt`, self-test steps, Camera info). APIs checked against the CameraX 1.6 jars. dev-47: verify-release 4/4, virtual Test Lab ✓ (see log), 2 probe gaps + 1 title bug fixed in dev-48. **Next: dev-48 on physical tiers (F01L, A14, OPPO A79, Pixel 8a, S22 Ultra; Galaxy A10 32-bit) when the daily Test Lab quota resets, + S8 Camera info report**, then fill the measured table in research/camera-features.md. Anonymous field survey still needs a privacy-policy line + user OK |
| 1.2 | Viewfinder: correct orientation in all 6 positions, front/back | 🟡 | S8 fixed in dev-30 (user saw it); 180° fix dev-37 passed Test Lab emulators; not re-checked on S8 since |
| 1.3 | Full-resolution photos | ✅ | S8: 4032×3024 with Samsung MakerNote (cloud, 2026-10-11 08:26); Galaxy S24 + realme C53 100 % (Test Lab dev-35). Pixel 8a: 16 MP not offered with preview (explained) |
| 1.4 | Tap to focus | 🟡 | Mapping fixed dev-31; not confirmed by eye |
| 1.5 | Zoom + lens switching (0.6×/1×/2×) | 🟡 | Self-test covers lenses; S8 has one back lens |
| 1.6 | Flash off/auto/on + selfie screen flash | 🟡 | Built dev-40; not seen on a phone |
| 1.7 | Automatic HDR (Ultra HDR where supported) | 🟡 | Default on; not measured |
| 1.8 | Night: auto Night + Night mode (Lens merge / maker extension) | 🟡 | Merge validated only synthetically (≈4× less noise); thresholds a first guess **dev-69:** a maker Night mode that saves under half the camera's full resolution (Pixel 8a: 5 of 16 MP) is dropped for that camera → Lens Night merge at full size (`makerNightBigEnough`, unit-tested). |
| 1.9 | Photo quality pipeline by capability tier (single frame → burst merge → maker extensions; cloud later) | ⬜ | Plan: docs/research/camera-quality.md; Quality Lab built, waiting for S8 lab sets |
| 1.10 | Heat / battery adaptation | 🟡 | Thermal guard built (fewer frames, uploads pause); not measured |
| 1.11 | **Video start delay**: recording only begins when the mic is ready and the encoder's first keyframe arrives | 🟡 | **Measured (dev-46 logs):** Pixel 8a 0.32 s, Galaxy A14 0.45 s, S22 Ultra 0.46 s, Android 8.1 F01L 1.02 s, OPPO A79 1.54 s (mic 0.71 s + first frame 0.84 s). CameraX starts both only on record (no API to pre-start). **Built (A, every phone):** native `onRecordingStarted` at the first recorded data; camera shows grey dot + "Starting…" until then, REC + timer from real 0:00; self-test warns > 700 ms. **Later R&D (B):** own encoder + ~1.5 s rolling buffer so the clip starts *before* the press (shares the Motion Photos buffer, 9). To validate tomorrow: S8 + tiers, the timer matches the saved clip length |
| 1.12 | Dependency security alerts (GitHub Dependabot: 2 high, 3 moderate on main) | 🟡 | Reviewed 2026-10-11 (`npm ls` per package). **Ships to users: only `decode-uri-component` 0.2.2** (expo-router → query-string; link parsing DoS on malformed `%` input). 0.5.0 is ESM-only and query-string 7 `require()`s it, so the 0.5.0 linear decoder is ported as `patches/decode-uri-component+0.2.2.patch`: 20 000/20 000 random inputs identical to 0.2.2, attack input 0.1 ms flat (original 33→63 ms and growing), confirmed in the Android bundle. **Build/dev tools only (not in the app or Lambda):** braces (patch-package), node-forge (Expo CLI / code-signing helper; our OTA signing + verify-release use Node crypto), uuid (ngrok, Xcode plugin), brace-expansion (CDK synth). Validate: app links open on S8 after the next build; then close #5 with the patch and dismiss the 4 build-only alerts with reasons (user OK). Never merge Dependabot PR #1 (expo-router v58) |

### 2. Essentials everyone expects

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 2.1 | Focus + exposure lock (hold) and exposure slider | 🟡 | Built (dev-50): tap = focus+expose (5 s auto-cancel) + sun slider; drag up/down = exposure compensation in Normal and PRO (150 dp/EV, clamped to the camera's range, haptic at 0), reset on a new tap / mode / camera; long-press = lock (no auto-cancel + Camera2 `CONTROL_AE_LOCK` after metering settles), badge says what the camera could hold (AE/AF, AE: fixed-focus, AF: no AE lock), tap unlocks. Emulator: tap box + sun ✓, drag → +0.4 EV for 66 dp ✓ (dev-48 native + new JS). To validate: lock on dev-50 (emulator + S8), exposure visibly changes, lock holds when pointing at a bright window, fixed-focus front camera shows "AE LOCK" |
| 2.2 | Volume-button shutter | 🟡 | Built: volume up/down + camera key (and Bluetooth selfie remotes, which send volume up) act as the shutter (photo / start-stop video / cancel timer) while the main camera is on screen and active; repeats ignored; key consumed only then (volume normal elsewhere). Window.Callback wrapped by delegation while attached, restored on detach (`HardwareShutter.kt`). To validate: emulator `adb shell input keyevent KEYCODE_VOLUME_DOWN` (photo taken, volume unchanged), gallery screen volume still works; S8 buttons + a selfie remote if available |
| 2.3 | Timer (3/10 s) | 🟡 | Now in Normal (dev-46) |
| 2.4 | Grid in Normal + smart level (shows when nearly straight) | 🟡 | Built (JS): Settings → Camera → **Grid** switch (rule of thirds in Normal, off by default; PRO keeps its own grid choice); Normal gets a **smart level**: the line appears only within 8° of straight, turns yellow when level, fades 1.5 s after (hidden at a deliberate tilt); PRO keeps the always-on level toggle. To validate: emulator (grid toggle reaches the camera, level with emulated tilt) + S8 |
| 2.5 | Mirror selfie setting | 🟡 | Research: CameraX 1.6 flips a saved photo only when `Metadata.setReversedHorizontal` is set (checked in the jar: `FileUtil` → `Exif.flipHorizontally`); Lens never set it → selfies were saved un-mirrored while the preview is mirrored. Built: Settings → Camera → **Mirror selfies** (on by default = as previewed, like Samsung); photos: lossless EXIF flip (pixels untouched; Glide/expo-image, our renderer and browsers apply all 8 EXIF orientations); video: `VideoCapture.setMirrorMode(MIRROR_MODE_ON_FRONT_ONLY)` (camera pipeline, no cost); off = true-to-life. To validate: S8 selfie with text in view, on and off, photo + video, thumbnails + viewer + web |
| 2.6 | Location in photos/videos (opt-in) | 🟡 | Built: Settings → Camera → **Save location** (off by default; asks for location permission when switched on, stays off if refused; note says shared photos keep it). `LocationTracker.kt`: Android LocationManager (GPS + network, no Play services), listens only while the camera is on screen (≤ every 5 s / 10 m), never writes a fix older than 10 min. Photos: `ImageCapture.Metadata.setLocation` (EXIF GPS); videos: `FileOutputOptions.setLocation`; Night merge now copies the GPS tags (it dropped them); Portrait and editor exports already keep EXIF GPS. Privacy policy already covers location in photo metadata. New app permissions ACCESS_FINE/COARSE_LOCATION (app.json). To validate: emulator `adb emu geo fix` → photo EXIF GPS (root), Night photo keeps it; S8 outdoors; web/viewer shows place (later) |
| 2.7 | Shutter feedback: haptic, sound setting, instant thumbnail | 🟡 | Haptic + flash animation (built before). Thumbnail is already instant for photos (shows the saved original before the 400 px thumb exists). **New:** system camera sounds via `MediaActionSound` (`ShutterSound.kt`): click at CameraX `onCaptureStarted` (the real start, not the press), one click per Night burst, record start (before the mic opens, so it isn't recorded) / stop (after the file closes); Settings → Camera → **Shutter sound** (on by default); silent/vibrate mutes it, except where the law requires a shutter sound (`MediaActionSound.mustPlayShutterSound()`, Android 13+). To validate: S8 sound on/off, silent mode, video beep not in the clip |

### 3. Video

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 3.1 | 1080p/4K, 30/60 fps, stabilization, HDR video (automatic in Normal, choices in PRO) | 🟡 | Self-test records 3 s; quality not measured |
| 3.2 | Upload while recording | ✅ | S8 (2026-10-10) |
| 3.3 | Pause / resume recording | 🟡 | Built: CameraX `Recording.pause()/resume()` (one file, paused time not recorded; checked in the 1.6 jar). While recording, the flip button's spot becomes ⏸ / ⏺ (enabled once frames flow); the REC pill shows `0:12 · PAUSED` with a yellow dot and the timer stops. Upload-while-recording is safe (it only uploads finished blocks; no stall timeout). To validate: S8 + emulator: pause 5 s → saved clip length = timer, no frozen frames, audio in sync |
| 3.4 | Time-lapse (auto speed, deflicker, every phone via own frame grab + encoder) | 🟡 | Built: TIME-LAPSE mode (left of VIDEO), offered only where the GPU viewfinder can feed a video encoder (recordable EGL config; else hidden). Frames from the viewfinder (same rotation code as the preview, cropped to 16:9 in the held orientation, long side = camera buffer ≤ 1920, preview bound 16:9 in this mode) → `TimeLapseEncoder` (MediaCodec H.264 + MediaMuxer, 30 fps, no audio, I-frame every 1 s, high bitrate). Automatic speed: 0.5 s interval for the first minute (15×), 1 s to 5 min (30×), 2 s to 20 min (60×), 4 s after (120×) → 10 min ≈ 17 s clip. Deflicker: each frame's gain pulled toward the running mean brightness (±15 %). REC shows `2:14 → 0:07`. Saves as a video (look = removable edit). To validate: emulator (mode shows, clip plays, length matches), S8 5-min clip: flicker, heat, orientation landscape/portrait, front camera |
| 3.5 | Slow motion (120/240 fps where exposed → 60 fps 2× → hidden; maybe interpolation later) | 🟡 | Built: SLO-MO mode, offered only where the camera can (capability `slowMotionFactor`). Tier A: CameraX `HighSpeedVideoSessionConfig` (no opt-in in 1.6), FHD/HD, 240 fps preferred else fastest ≥ 120 → 30 fps file that already plays slowed (8×/4×), preview + video only. Tier B: bind 60 fps, record, then `SlowMotion.retime` copies the samples with timestamps × 2 (no re-encode, lossless) → 2× slow. Silent (no audio track), torch works. REC shows `0:05 · 4× SLOW`. Self-test steps added: slow motion (clip ≈ 3 s × factor) and time-lapse (≥ 6 frames in 6 s). To validate: Test Lab tiers (which tier each phone gets), S8 (60 fps → 2×), playback smoothness, orientation |
| 3.6 | Low-light video (low-light boost where supported, else tuned AE) | 🟡 | Built (Normal video only; PRO keeps its fixed fps): 24–30 fps auto-exposure range where the camera offers it (≈ 25 % more light per frame in the dark; VFR file, players + our transcoder handle it), and CameraX `enableLowLightBoostAsync` where `isLowLightBoostSupported` (Android 15+ HALs; 30 fps SDR only, as CameraX requires). REC shows `· LOW LIGHT` while the boost is ACTIVE (`lowLightBoostState`). Reach measured by 1.1 probe `lowLightBoost`. To validate: S8 dark-room video Normal vs PRO (brightness, noise, frame rate in ffprobe); Test Lab Android 15/16 phones for the boost |
| 3.7 | Photo while recording | 🟡 | Built: while recording, the gallery spot becomes a white photo button. Tier A: a full-resolution JPEG `ImageCapture` (16:9, highest) bound next to the video only where `isSessionConfigSupported(preview + video + photo)`; extra last bind attempt without it so a phone that over-claims still records. Tier B: the current camera frame from the GPU viewfinder (16:9 upright, stream resolution, never upscaled, JPEG 95, EXIF date). Self-test video step now takes one and reports `videoPhoto` (size + which tier). To validate: Test Lab tiers (which tier each phone gets) + S8 |
| 3.8 | Audio quality (wind, external/Bluetooth mic) | 🟡 | Research (CameraX 1.6 jar): `Recorder.Builder.setAudioSource` exists; the default `CAMCORDER` source is the one phone makers tune for their own camera (their noise/wind processing) → kept; no public wind-noise API on Android. Wired/USB mics are routed automatically; Bluetooth mics use the call profile (8–16 kHz, worse than the built-in mic) → deliberately not used. **Built:** recording sound health from `AudioStats`: the REC pill shows **NO SOUND** the moment the mic is silenced (Android 12+ mic privacy toggle, another app holding it) or fails, so a silent video never goes unnoticed; `· EXT MIC` when a wired/USB mic records. To validate: S8 with mic toggle off (Android 9 has none: test by another app recording), wired headset |

### 4. Portrait

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 4.1 | Person mask in the photo + blur as an edit | ✅ | S8 selfies 2026-10-10: mask correct and aligned, blurred preview (cloud) |
| 4.2 | Live blur in viewfinder, styles, "No person found" | 🟡 | In 0.1 |
| 4.3 | Edge refinement (hair), realistic disc bokeh, edge-aware compositing | 🟡 | Prototyped on the user's real S8 portraits (research/portrait.md: halo −0.043 → −0.009, ring ghosts gone, hair outline follows hair). Built: capture-time guided-filter refinement in a 1.5 % trimap band, mask stored at 768 px (20–29 KB); renderer 64-tap golden-angle disc, highlight-weighted, background-only taps, radius = fraction of the long side (2.2 % at f/2.8; previews now match exports); tile margin = blur reach; live viewfinder same mapping. Unit tests 34/34 (new: guided filter sharpens a soft mask onto the photo edge; blur mapping). To validate: new S8 portraits (hair, glasses, busy background), export time on S8 for 12 MP, editor live preview speed |
| 4.4 | Automatic blur strength (subject size/distance) | 🟡 | Built (Normal camera; PRO keeps its f-number): like a real lens, the more of the frame the person fills, the shallower the depth of field: coverage ≥ 55 % → f/1.8, 30 % → f/2.8, 12 % → f/4, smaller → f/5.6 (linear between; `PortraitStyle.autoAperture`). Photo: from the capture mask coverage, saved in the recipe (editable later); live viewfinder: from the smoothed live coverage, same mapping. Unit test (mapping + monotonic). To validate: S8 close-up vs half-body vs full-body portraits look natural |
| 4.5 | Pets/objects (ML Kit subject segmentation where Play services exist) | 🟡 | Built: when the person model finds nobody, Portrait tries ML Kit subject segmentation (`play-services-mlkit-subject-segmentation:16.0.0-beta1`, ~200 KB, model via Play services, install-time download meta-data `subject_segment`; beta API → every failure = "no subject"). Accepts a subject covering 2–90 % of the frame; same refinement + auto blur; recipe `depthKind: subject`; notice "Portrait applied to the subject". Phones without Play services: people only (as before). Limitation: the live viewfinder blur stays people-only (the subject model is too heavy for live on budget phones). To validate: S8 photo of a pet/object (Play services present), self-test portrait step on Test Lab (racks may now find a subject) |
| 4.6 | Maker bokeh extension where offered; depth-graded blur (depth / cloud) | ⬜ deferred | Deliberately not built yet: maker bokeh bakes the blur into the photo (breaks removable edits + our styles), and its reach is unknown until the 1.1 probes report `extensions: bokeh` per phone (test day). Depth-graded blur needs a depth model: too heavy on-phone → cloud R&D later |

### 5. Looks (filters)

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 5.1 | 13 looks, live in viewfinder, strength, removable edit | 🟡 | Exact iOS LUTs; now in Normal (dev-46) |
| 5.2 | Video looks (recording + playback + export) | ✅ | Playback with look: user confirmed on S8 (dev-45, 2026-10-11) |
| 5.3 | Smart look suggestion (scene-aware, one tap) | 🟡 | Built (Normal camera, no look chosen, Photo/Video): every 1.5 s the ~320 px viewfinder copy → ML Kit image labeling (Play services, ~200 KB, install-time `ica`) → labels ≥ 70 % → look (sunset → Golden hour, food → Warm, snow → Cool, night → Cinematic, flowers/beach/mountains/sky → Vivid); must repeat twice before it shows; a yellow-outlined "✦ Golden hour" chip at the front of the looks row, one tap applies (never automatic). No Play services → no suggestion. Unit test for the mapping (36/36). To validate: S8 outdoors (sunset, food, plants), check it doesn't flicker or heat **dev-69:** no suggestion for black/flat frames (mean luma < 18 or spread < 6): Device Farm showed "✦ Vivid" in a dark box. |

### 6. Editing

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 6.1 | Photo editor: auto, light/colour, crop/rotate/straighten, portrait, copy/paste | 🟡 | 1024 px tiles for big photos; not tested on big photos on a phone |
| 6.2 | Video trim | 🟡 | Built as a removable edit (recipe `trim: {start, end}`; the original stays whole, change or remove it any time): player ✂ tool (own videos) → the timeline's nearer handle follows the finger, frame preview, ≥ 0.5 s, Cancel / Save; playback starts at the trim start, stops at the end, seeks stay inside. Save/Share export through Media3 `ClippingConfiguration`; trim-only (no look) uses `experimentalSetTrimOptimizationEnabled` (re-encodes only up to the first key frame); a trim alone skips the look shader in playback and posters. Limitations: the web player plays the whole video; HLS streams aren't clipped (playback is). To validate: S8 trim + save to gallery (duration with ffprobe), share, playback stops at the end |
| 6.3 | Non-destructive edits everywhere (original kept) | ✅ | By design; recipe stored separately |

### 7. Intelligent enhancements

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 7.1 | Scene-aware automatic decisions (Night, HDR, frame counts) from measured data | ⬜ | Depends on 1.9 |
| 7.2 | Face-aware exposure / focus | 🟡 | Built (Normal camera, auto exposure, not Night, not while long-press locked): Camera2 `CONTROL_SCENE_MODE_FACE_PRIORITY` where the camera lists it (`CONTROL_AVAILABLE_SCENE_MODES`): the camera's own face detection steers AE/AF/AWB (no ML, no heat; 3A modes, EV and tap-to-focus keep working per the Camera2 spec). Reach added to the 1.1 probes (`facePriority`). If test day shows low reach: fallback = our own face detection → metering points. To validate: S8 backlit face (window behind) Normal vs PRO |
| 7.3 | Smart burst (hold shutter, best shot, stack) | 🟡 | Built (Photo mode, Normal + PRO, not RAW / auto-Night): hold the shutter ≥ 0.35 s → photos back to back until release (max 20), counter on the shutter, each a normal photo (mirror, location, sound). Best shot picked on the phone (`BurstPicker`): sharpness (Laplacian variance of a 512 px copy, normalised in the burst) + eyes open + smile where ML Kit face detection (Play services) finds faces (else sharpness only). Stack without a server change: `edit.burst = {id, pick, count}` (synced with the photo, never a visual edit, not pasted). Roll shows only the pick with `⧉ N`; the viewer browses the burst (shots sit together) with `⧉ PICK` / `⧉ MAKE PICK · N`. Unit test (sharp > soft > softer, 37/37). To validate: S8 burst speed + pick quality (moving kid/pet, eyes closed in one frame), Test Lab burst fps (self-test) **dev-69:** every phone got 1 shot in 1.5 s on best quality (Device Farm, 7 phones) → the burst swaps only the photo use case to the quick capture path (0.54–0.86 s vs 1.3–2.6 s per photo) and requests the next shot at capture start (saving overlaps), best quality restored after; single shots stay best quality. Re-test on Device Farm. |
| 7.4 | Auto straighten / horizon | 🟡 | Built (Normal camera, photos): the accelerometer's tilt from level at the shot; an accidental 1–4° tilt (not lying flat) becomes `crop.straighten` (a removable edit: original untouched, reset in the editor; bigger tilts are taken as deliberate). Sign from the geometry convention (+ = content rotated clockwise = phone turned clockwise), negated for mirrored selfies. Notice "Horizon straightened 2.1°". To validate: S8 — tilt ~2° left/right, portrait + landscape, back + front (mirror on/off): the horizon must come out level, not doubled |

### 8. PRO (manual controls only)

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 8.1 | Manual ISO / shutter / WB / focus / EV dials | 🟡 | S8 manual exposure available |
| 8.2 | RAW (DNG) | 🟡 | Develop path untested |
| 8.3 | Monitoring: histogram, peaking, zebra, false colour, level, grid; presets | 🟡 | |

### 9. Later (after everything above)

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 9.1 | Aspect ratios 4:3 / 16:9 / 1:1, WYSIWYG viewfinder (Android) | 🟡 | Built: the GL viewfinder draws the camera only inside the kept frame (black around it; photo 4:3 under the top controls, video 16:9 centred); grid/guide sit in the frame; 16:9/1:1 photos keep the full 4:3 file plus a removable centred crop. tsc clean, Kotlin compiles; emulator + S8 check pending |
| 9.2 | Motion photos (3 s around the shot, Google Motion Photo format) | 🟡 | Built: viewfinder ring-buffer encoder (1.5 s before + 1.5 s after), XMP + appended MP4 (Ultra HDR gain map kept), MOTION toggle (off by default), ▶ MOTION in the viewer. Unit tests 3/3 (format, Ultra HDR merge, plain photo). Phone check pending (Google Photos must play it) |
| 9.3 | QR codes in the camera | 🟡 | Built: ML Kit (bundled, already in the APK) on a 640 px viewfinder copy every 400 ms, stable chip (2 reads in / 3 misses out), open https / call / email / copy; other schemes never opened (unit test). Settings switch, on by default. Phone check pending |
| 9.4 | Document scanning | 🟡 | Built: SCAN in the mode strip → Google's ML Kit document scanner (Play services, edges + perspective + clean-up, ≤ 20 pages) → pages saved to the roll as photos. Phone check pending (needs Play services; emulator has none in this image? check) |
| 9.5 | Hyperlapse (time-lapse while walking) | 🟡 | Built: TIME-LAPSE detects being carried (gyro/accelerometer, hysteresis) → 8× frames + preview stabilization where supported; REC '· HYPERLAPSE'. Phone check pending (walk test on S8 + a phone with preview stabilization); software stabilization only if needed |
| 9.6 | Astro (long exposures on a tripod) | 🟡 | Built: Night + still + very dark + manual exposure ≥ ½ s → ≤ 4 s frames at ≤ ISO 800, ~16 s stacked with the Night merge; pill 'Astro 16s' + countdown. Unit tests 4/4 (plan math). Phone check pending (S8 on a tripod outdoors at night; S8's longest exposure decides if it qualifies) |

Still later: iPhone parity for Android-first features (after Android is validated).

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
| 2026-10-11 | dev-60 | release | CI | verify-release 60 4/4 (runtime n-fe78ec4a4fe4fc5b1441); ML Kit manifest fix confirmed (dev-57 failure gone) |
| 2026-10-11 | dev-61 | release | CI | verify-release 61 4/4 (runtime n-a52777dea61dd0f02dad) |
| 2026-10-11 | dev-61 | 9.1 aspect ratios | Emulator 360 dp | 4:3 frame under the top controls, 16:9 full-width centred, 1:1 square centred in the 4:3 area, time-lapse 16:9 ✓; a 1:1 photo opens square in the viewer (removable crop) ✓ |
| 2026-10-11 | dev-62/63 | release | CI | verify-release 62 and 63 4/4 |
| 2026-10-11 | dev-63 | 9.2 motion photo | Emulator | MOTION toggle shows; file format correct (XMP Item:Length = appended MP4, ffprobe reads it) ✓. **Bug:** emulator's software encoder delivered ~0.4 fps and only one key frame → 11-frame clip, still at 26 s, and the buffer never trimmed (memory would grow). Fixed (dev-64): key frame requested every second, 5 s memory cap, encoder too slow → smaller clip (1280→960→640→480), clip under 8 fps → photo saved without motion |
| 2026-10-11 | dev-64/65 | release | CI | verify-release 64 and 65 4/4 |
| 2026-10-11 | dev-64 | 9.2 motion photo | Emulator | step-down works (960×1280 → 720×960 → 480×640 → 352×480); emulator encoder stays ~0.4 fps at every size (per-frame cost of its GPU→encoder path, not resolution) → only real phones can judge the clip; added: auto-off + notice when even the smallest size is too slow |
| 2026-10-11 | dev-65 | 9.4 scan | Emulator | SCAN in the mode strip ✓; this emulator image's Play services can't fetch the scanner module → clear "Could not scan … not available" dialog ✓ (real phones with the Play Store download it on first use) |
| 2026-10-11 | dev-65 | 9.5 hyperlapse | Emulator | fake gyro movement → REC shows `0:33 → 0:03 · HYPERLAPSE` ✓; clip 720×1280, 40 frames, valid ✓ (frame rate limited by the emulator's draw speed; the 8× rate needs a phone) |
| 2026-10-12 | dev-66 | release | CI | verify-release 66 4/4 — test-day build |
| 2026-10-12 | dev-67 | release | CI | verify-release 67 4/4 (runtime n-ef68e383a45e9ee380fe); extended self-test |
| 2026-10-12 | dev-67 | self-test | F01L Android 8.1 (old) | 23 pass, 1 warn (portrait: no person), 1 skip (no heat API); motion clip 3.2 s 23.7 fps; pause 2.9 s ✓; trim export 1.5 s ✓; editor 12 MP 3.2 s; ML models ✓ |
| 2026-10-12 | dev-67 | self-test | Galaxy A14 (budget) | 22 pass, 3 warn, **1 fail: smart burst 1 shot in 1.5 s** (0.6 photos/s); video start 808 ms; ML models download timed out |
| 2026-10-12 | dev-67 | self-test | OPPO A79 (budget) | 20 pass, 4 warn, 2 fail: smart burst 1 shot; upload paused because the phone was "severe" hot (by design → now a warning); video start 1387 ms |
| 2026-10-12 | dev-67 | self-test | Xiaomi 14 Android 15 | 26 pass, 1 warn (portrait), 0 fail; 4K video, motion clip 29.8 fps, readers cost 0 fps |
| 2026-10-12 | dev-67 | self-test | Galaxy S25 Ultra Android 15 | 22 pass, 3 warn, 2 fail: **viewfinder 30 → 15 fps with readers/motion/Portrait**; smart burst 1 shot (first shot 2.4 s); Quality Lab maker NIGHT: Samsung camera HAL crashed after the RAW step (user Night mode passed) |
| 2026-10-12 | dev-67 | Robo (real screens) | virtual Android 15, 16 | no crash/ANR; **found: Geist labels clipped ("PHOT", "Coo", "Golden")**: text measured before the runtime font load kept the system font's width → fonts now built into the APK (expo-font plugin); fix verified on Android 15 Robo (repacked APK): all labels whole |
| 2026-10-12 | dev-67 | measured | 5 phones | probes table filled in docs/research/camera-features.md "Measured results" |
| 2026-10-12 | dev-68 | release | CI | verify-release 68 4/4 (runtime n-7631edf9eed302c62c5f); 32-bit job hung on "Install NDK" → cancelled + re-ran failed jobs |
| 2026-10-12 | dev-68 | Robo (real screens) | virtual Android 15, 16 | **labels whole** ("No look", "Golden hour", "Cinematic", "PRO", "PORTRAIT", "SCAN"): font fix confirmed; no crash/ANR |
| 2026-10-12 | dev-68 | self-test | virtual Android 15 | new steps run: previewStats, shutter speed **best quality 1723 ms vs quick capture 759 ms** per photo (evidence for smart burst, 7.3); hot-phone upload rule; 21 pass, 4 warn, 1 fail (smart burst 1 shot, as on real phones) |
| 2026-10-12 | dev-68 | self-test (AWS Device Farm) | Galaxy S9 Android 9 (S8 stand-in) | 20 pass, 4 warn, 1 fail (smart burst 1 shot); 12 MP photos, selfie saved mirrored, 4K 28.8 fps + sound, pause/trim/editor ✓, ML models present; viewfinder 15 fps = **camera delivers 15 fps** in the dark rack (draw 3 ms); shutter best quality 2.1 s vs quick capture 1.25 s; video start 921 ms |
| 2026-10-12 | dev-68 | self-test (Device Farm) | Galaxy S25 Ultra Android 15 | 26 pass, 2 warn, 2 fail; **viewfinder answer: camera delivers 15 fps in the dark rack, our draw ~1 ms, readers +0.4 ms** (dev-67's 30→15 was the camera's AE, not the readers); shutter **Ultra HDR 2.6 s / JPEG 1.3 s / quick 0.86 s**; smart burst 1 shot; Quality Lab maker NIGHT fails again after the RAW step (user Night passed, 8.6 s) |
| 2026-10-12 | dev-68 | self-test (Device Farm) | Pixel 8a Android 15 | 18 pass, 12 warn, 1 fail; photos 12 of 16 MP (known); **Night = Google's extension at 5 MP (1920×2560, 31 %)** → below original quality: decide Lens merge vs maker Night by output size; shutter JPEG 1.4 s vs quick 0.55 s; smart burst 1 shot |
| 2026-10-12 | dev-68 | self-test (Device Farm) | Redmi Note 13 Android 15 | 18 pass, 9 warn, 1 fail; photos 8 MP of the 9 MP max (4:3 vs 16:9), viewfinder 29.5 fps with readers, motion clip 29.8 fps; shutter JPEG 1.75 s vs quick 0.55 s; smart burst 1 shot |
| 2026-10-12 | dev-68 | Device Farm runner | Galaxy A14 5G Android 13 | no report: Android blocked the adb TEST_LOOP launch without the intent's mime type → testspec fixed (4bfa79e), re-run |
| 2026-10-12 | dev-68 | self-test (Device Farm) | Galaxy A14 5G Android 13 | 25 pass, 2 warn, 1 fail (smart burst 1 shot); viewfinder 29.5–30 fps with readers/motion, motion clip 29.8 fps, 1080p video + sound; shutter JPEG 1.75 s vs quick 0.54 s |
| 2026-10-12 | dev-68 | stock camera vs Lens (Device Farm screenshots) | S9, S25 Ultra, Pixel 8a | dark box: Lens turned Night on automatically and lifted the viewfinder (stock apps black); lens chips real lenses only (S25U .6/1/5.1×, Pixel .5/1/2×); labels whole. **Found:** OTA "New version ready" pill overlaps the mode strip/shutter; ✦ "Vivid" suggestion shown in a black scene. Stock photo not captured (volume key ignored) |
| 2026-10-12 | — | **finding (7 phones)** | all | **quick capture is 2.5–3× faster than best quality everywhere; smart burst gets 1 shot in 1.5 s on every phone** → 7.3 fix: burst on the quick path (measure quality difference before switching the single shot) |
| 2026-10-11 | dev-46 | UI | Emulator 360 dp | Normal/PRO layout, modes, styles, "No person found", Night draws; live blur with a person not testable (virtual camera can't be aimed headless) |
