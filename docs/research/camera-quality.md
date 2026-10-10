# Camera quality R&D (Android)

Status: research done 2026-10-10, testing not started. Goal: one photo pipeline
that works across a wide range of Android phones, chosen by measured results,
not per-model tuning or guesses.

## Problem

On the Galaxy S8, Lens photos are softer, darker and grainier than the Samsung
camera's, both in the viewfinder and in saved photos. Colours are fine.

Two causes were plain bugs, fixed in dev-32 (`06151fc`): photo modes were locked
to a fixed 30 fps, which capped the shutter at 1/30 s so indoor shots pushed ISO
(dark, grainy); and the viewfinder shader used mediump texture coordinates
(soft on Mali GPUs). Tap-to-focus also pointed at the wrong spot before dev-31.
**Measure again after dev-32 before deciding anything below.**

## Why the stock camera is better (research findings)

- The stock app's quality comes from vendor code (multi-frame merge, HDR, scene
  tuning) that third-party apps can't call through plain Camera2. Android has no
  shared processing pipeline, unlike iOS. Instagram, Snapchat and others face the
  same gap; Samsung gives some partner apps private access.
- Another app's settings can't be read, and copying them wouldn't bring the
  processing anyway.

## Options

| # | Approach | Reach | Quality gain | Cost / risk |
|---|---|---|---|---|
| A | **Tuned single frame** (variable fps, HQ noise reduction/edge modes, correct focus) | every phone | baseline; fixes our own mistakes | low; done in dev-32 |
| B | **OEM camera extensions** (CameraX `ExtensionMode.AUTO / HDR / NIGHT`): the phone maker's own processing, exposed to apps | only phones whose maker ships the vendor library (e.g. Galaxy S22 had all modes in 2022; Pixel and OnePlus 10 Pro had none then); support varies by model and OS version | highest where available (it *is* the stock processing) | low code (we already use NIGHT); availability must be measured |
| C | **YUV burst merge** (capture 4–8 processed frames, align, average) | any phone that streams full-res YUV at a few fps | less noise, better shadows; weaker than raw because the ISP has already denoised and tone-mapped | medium; ~0.5–2 s processing and heat; we already have `NightMerge.kt` to reuse |
| D | **RAW burst merge** (HDR+ style: raw Bayer frames, align, merge, our own tone mapping) | FULL / LEVEL_3 phones with the RAW capability | best achievable without vendor code (Google HDR+, MotionCam) | high; 12 MP HDR+ took ~4 s on device in the paper; big engineering effort |
| E | **Cloud processing** of a burst (upload frames, merge on AWS) | every phone with a connection | same as C/D, no phone heat | upload size (8 frames × ~3–24 MB) on 0.6 MB/s uplinks; slow result; bandwidth cost |
| F | **Low Light Boost** (Android 15+ AE mode, or the Play services software version for preview) | Android 15+ with HAL support (Pixel 10 at end of 2025); software version is broader | preview brightness in the dark | low; preview only, not still quality |

**Hypothesis to test (not a decision):** a tier chosen at runtime **by
capability, never by phone model**: B where the phone offers it → otherwise C
(or D on raw-capable phones) → otherwise A. E is a possible later "enhance in
cloud" option, since Lens is cloud-first.

## Test plan

### 1. Capability survey (how many phones each tier can reach)

No public breakdown of Camera2 hardware levels, RAW support or extensions
exists, so we measure it:
- An anonymous capability report from the app on first camera start: model, OS,
  hardware level, capabilities (RAW, MANUAL_SENSOR, BURST_CAPTURE), extension
  modes available, max YUV burst fps. Capabilities only, no images, no personal
  data.
- Optionally one run on AWS Device Farm or Firebase Test Lab real-device pools
  to read capabilities across many models (cameras face a rack there, so it's
  useless for image quality, but fine for capabilities and processing time).

### 2. Quality Lab (hidden screen in the app)

One shutter press captures the same scene with each pipeline the phone supports
(A, B-modes, C with 4 and 8 frames, D if raw), and uploads the set with
metadata (ISO, shutter, processing time, temperature before and after) to S3.

### 3. Measuring

Generic no-reference scores (BRISQUE etc.) are unreliable on phone photos, so:
- **Fixed scenes** shot from a tripod or propped phone: bright outdoor, indoor
  room light, dim room, backlit window, moving subject. Tape a printed test
  chart or a grey card plus text into the scene.
- **Objective, per attribute:** noise = standard deviation on the flat grey
  area; sharpness = Laplacian variance on the text area (relative between
  pipelines in the same scene, not an absolute threshold); exposure = histogram
  and clipped highlights; speed = shutter-to-saved time; heat = temperature
  change over 20 shots.
- **Blind human rating:** a private web page shows two versions of the same
  scene side by side, unlabeled; we pick the better one. Samsung camera photos go
  in as the reference.

### 4. Devices

Galaxy S8 (Android 9, Exynos) now. To be useful the sample needs at least: one
recent Samsung (likely has extensions), one cheap phone (Redmi/Realme, likely
LIMITED level), one Pixel. Borrowed or second-hand phones are enough.

### 5. Decision rule

Pick the tier order from the data: a pipeline is used on a phone only if it
beats the single frame on noise and sharpness without blowing exposure, and
stays under ~1.5 s and a small temperature rise. Document the results here.

## Built (2026-10-10, dev-33)

- **Capability report** (`deviceReport`, Camera info screen): now also lists the
  maker's extension modes (CameraX and Camera2), noise-reduction and edge modes,
  sensor orientation, chipset, and the largest JPEG / YUV / RAW size with its
  maximum back-to-back rate. Opening Camera info or the Lab sends it anonymously
  to `POST /v1/lab/probes` → `s3://<media bucket>/lab/probes/<maker_model>/<hash>.json`
  (identical reports stored once; no account link). Not yet sent automatically
  for every user (needs a privacy-policy line first).
- **Quality Lab** (Settings → Camera info → Quality Lab, Android): "Capture set"
  runs every pipeline the phone supports on the same scene, each after the camera
  rebinds and settles 1.5 s:
  single JPEG · single Ultra HDR (Android 14+) · burst ×8 quality capture ·
  burst ×8 fast capture · RAW DNG burst ×6 (RAW phones) · maker AUTO / HDR /
  NIGHT (where available) · today's Lens Night (8-frame merge).
  Each step records files, per-frame time, ISO, exposure, focus, total time and
  thermal status before/after. "Add reference" attaches the phone camera app's
  photo of the same scene. Sets stay on the phone until uploaded
  (`POST /v1/lab/sets` → `lab/sets/<setId>/`, Content-MD5 checked per file,
  meta.json with the full device report).
- Native: `CameraConfig.extension` / `captureMode` (lab-only props),
  `takeBurst(frames)` (kept frames, no merge), `thermalStatus()`.

## Sources

- Android camera extensions: https://developer.android.com/media/camera/camera-extensions , https://source.android.com/docs/core/camera/camerax-vendor-extensions
- Galaxy S22 exposes all extensions (2022): https://www.sammobile.com/?p=162761
- HDR+ paper: https://research.google/pubs/burst-photography-for-high-dynamic-range-and-low-light-imaging-on-mobile-cameras/ ; open implementation: https://github.com/amonod/hdrplus-python , IPOL analysis: https://www.ipol.im/pub/art/2021/336//article.pdf
- MotionCam (raw burst app): https://github.com/v6p/motioncam
- Real-time mobile denoising: https://research.google/pubs/real-time-video-denoising-on-mobile-phones
- Low light boost: https://developer.android.com/media/camera/camera2/low-light-boost , https://developer.android.com/media/camera/lowlight
- Camera2 hardware levels: https://source.android.com/docs/core/camera/versioning
- Third-party camera quality gap: https://esper.io/blog/android-camera-api-podcast , https://www.guidingtech.com/why-is-instagram-camera-quality-so-bad-on-android/
- No-reference metrics on phone photos: https://its.ntia.gov/publications/details?pub=3235 , https://arxiv.org/pdf/2008.11961
