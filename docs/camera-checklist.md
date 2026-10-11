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
| 0.1 | **dev-46 batch** (commit 139a40f): alignment pass (all screens), Normal/PRO restructure (creative in Normal, manual in PRO), mode-strip tap fix, live Portrait blur + "No person found", Portrait styles (Natural/Studio/Mono/Stage), Night viewfinder preview | 🔨 | Done: CI all green (Android 64/32-bit, iOS), `verify-release 46` 4/4, Kotlin unit tests 32/32, 7 shaders pass Khronos glslang, Test Lab self-test on 5 tiers (no regressions; see log), emulator 360 dp: Normal/PRO layout, mode switching, style chips, "No person found" notice, Night mode draws without GL errors. **Not yet proven (needs the S8):** live blur with a real person, styles on a person, Night preview brightness/grain in the dark, Portrait smoothness + heat (emulator too slow to judge: ML runs through ARM translation) |

### 1. Measurement + core capture reliability (every phone first)

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 1.1 | **Capability probes** for all planned features (high-speed video, 60 fps per size, time-lapse profiles, video+photo binding, burst fps, low-light boost, feature groups, extensions incl. bokeh) in Camera info + self-test + anonymous survey | ⬜ | Gap found 2026-10-11: current reports lack these |
| 1.2 | Viewfinder: correct orientation in all 6 positions, front/back | 🟡 | S8 fixed in dev-30 (user saw it); 180° fix dev-37 passed Test Lab emulators; not re-checked on S8 since |
| 1.3 | Full-resolution photos | ✅ | S8: 4032×3024 with Samsung MakerNote (cloud, 2026-10-11 08:26); Galaxy S24 + realme C53 100 % (Test Lab dev-35). Pixel 8a: 16 MP not offered with preview (explained) |
| 1.4 | Tap to focus | 🟡 | Mapping fixed dev-31; not confirmed by eye |
| 1.5 | Zoom + lens switching (0.6×/1×/2×) | 🟡 | Self-test covers lenses; S8 has one back lens |
| 1.6 | Flash off/auto/on + selfie screen flash | 🟡 | Built dev-40; not seen on a phone |
| 1.7 | Automatic HDR (Ultra HDR where supported) | 🟡 | Default on; not measured |
| 1.8 | Night: auto Night + Night mode (Lens merge / maker extension) | 🟡 | Merge validated only synthetically (≈4× less noise); thresholds a first guess |
| 1.9 | Photo quality pipeline by capability tier (single frame → burst merge → maker extensions; cloud later) | ⬜ | Plan: docs/research/camera-quality.md; Quality Lab built, waiting for S8 lab sets |
| 1.10 | Heat / battery adaptation | 🟡 | Thermal guard built (fewer frames, uploads pause); not measured |
| 1.11 | **Video start delay**: recording only begins when the encoder's first keyframe arrives | ⬜ | Found by Test Lab 2026-10-11: OPPO A79 delivered the first frame ~1.5 s after record was pressed (3 s test clip = 1.84 s). Fix: show "recording" only once frames flow, pre-warm the encoder, self-test measures start delay on every phone |
| 1.12 | Dependency security alerts (GitHub Dependabot: 2 high, 3 moderate on main) | ⬜ | Review each; never merge Dependabot PR #1 (expo-router v58) |

### 2. Essentials everyone expects

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 2.1 | Focus + exposure lock (hold) and exposure slider | ⬜ | |
| 2.2 | Volume-button shutter | ⬜ | |
| 2.3 | Timer (3/10 s) | 🟡 | Now in Normal (dev-46) |
| 2.4 | Grid in Normal + smart level (shows when nearly straight) | ⬜ | Grid/level exist in PRO (🟡) |
| 2.5 | Mirror selfie setting | ⬜ | |
| 2.6 | Location in photos/videos (opt-in) | ⬜ | Privacy policy line needed |
| 2.7 | Shutter feedback: haptic, sound setting, instant thumbnail | 🟡 | Haptic + flash animation built |

### 3. Video

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 3.1 | 1080p/4K, 30/60 fps, stabilization, HDR video (automatic in Normal, choices in PRO) | 🟡 | Self-test records 3 s; quality not measured |
| 3.2 | Upload while recording | ✅ | S8 (2026-10-10) |
| 3.3 | Pause / resume recording | ⬜ | |
| 3.4 | Time-lapse (auto speed, deflicker, every phone via own frame grab + encoder) | ⬜ | Research: docs/research/camera-features.md |
| 3.5 | Slow motion (120/240 fps where exposed → 60 fps 2× → hidden; maybe interpolation later) | ⬜ | Reach unknown until 1.1 |
| 3.6 | Low-light video (low-light boost where supported, else tuned AE) | ⬜ | |
| 3.7 | Photo while recording | ⬜ | Device-dependent; GL-frame fallback |
| 3.8 | Audio quality (wind, external/Bluetooth mic) | ⬜ | Research needed |

### 4. Portrait

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 4.1 | Person mask in the photo + blur as an edit | ✅ | S8 selfies 2026-10-10: mask correct and aligned, blurred preview (cloud) |
| 4.2 | Live blur in viewfinder, styles, "No person found" | 🔨 | In 0.1 |
| 4.3 | Edge refinement (hair), realistic disc bokeh, edge-aware compositing | ⬜ | docs/research/portrait.md (A4, B2, B4) |
| 4.4 | Automatic blur strength (subject size/distance) | ⬜ | |
| 4.5 | Pets/objects (ML Kit subject segmentation where Play services exist) | ⬜ | |
| 4.6 | Maker bokeh extension where offered; depth-graded blur (depth / cloud) | ⬜ | |

### 5. Looks (filters)

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 5.1 | 13 looks, live in viewfinder, strength, removable edit | 🟡 | Exact iOS LUTs; now in Normal (dev-46) |
| 5.2 | Video looks (recording + playback + export) | ✅ | Playback with look: user confirmed on S8 (dev-45, 2026-10-11) |
| 5.3 | Smart look suggestion (scene-aware, one tap) | ⬜ | |

### 6. Editing

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 6.1 | Photo editor: auto, light/colour, crop/rotate/straighten, portrait, copy/paste | 🟡 | 1024 px tiles for big photos; not tested on big photos on a phone |
| 6.2 | Video trim | ⬜ | Essential, missing |
| 6.3 | Non-destructive edits everywhere (original kept) | ✅ | By design; recipe stored separately |

### 7. Intelligent enhancements

| # | Feature | Status | Evidence / limits |
|---|---|---|---|
| 7.1 | Scene-aware automatic decisions (Night, HDR, frame counts) from measured data | ⬜ | Depends on 1.9 |
| 7.2 | Face-aware exposure / focus | ⬜ | |
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
| 2026-10-11 | dev-46 | UI | Emulator 360 dp | Normal/PRO layout, modes, styles, "No person found", Night draws; live blur with a person not testable (virtual camera can't be aimed headless) |
