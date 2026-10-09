# Design: Android pro camera, looks, editor, Night & Portrait

Status: **approved and built (2026-10-09)**, emulator-tested, not yet on a real phone.
User guide: [features/android-camera.md](../features/android-camera.md).
Decisions: Portrait uses the **bundled** ML Kit selfie model (~5 MB, no Play
services needed); OEM Bokeh isn't used (it would bake the blur into the
original); RAW on Android is still to do.

Goal: Android (the launch platform) gets everything the iPhone build has: the pro
camera with manual controls, 13 looks (live and on photos), the editor, Night and
Portrait. It has to run on as many phones as possible, from Android 7 budget
phones to current flagships, and stay smooth and cool. No new cloud cost.

## 1. Audit: what we have and what blocks Android

| Finding | Where | Impact |
|---|---|---|
| The pro camera and imaging are one iOS-only Expo module (`platforms: ["apple"]`) | `modules/lens-camera` | Android falls back to `BasicCamera` (expo-camera), with no editor, looks, Night or Portrait |
| The JS contract is already platform-neutral: `LensCameraView` props/events, `Capabilities`, `LensImaging.renderImage/exportVideo/hasDepth`, `LensEditView` | `modules/lens-camera/index.tsx` | **Good news:** an Android implementation of the same contract lights up `ProCamera`, the editor, paste-edit, edited previews and share/save with edits, with little JS change |
| The UI already hides features by capability (`manualExposure`, `raw`, `nightFrames`, `depth`, `flash`, lenses) | `src/components/pro/ProCamera.tsx` | Fits a tiered Android capability model |
| Looks and adjustments are Core Image filter chains, some of them Apple built-ins (Noir, Chrome, Instant) | `ios/Imaging/Looks.swift`, `ImagePipeline.swift` | Android must reproduce them so an edit looks the same on both platforms (recipes sync through the cloud) |
| `Alert.prompt` (Save preset) exists only on iOS | `ProCamera.tsx` | Save preset is broken on Android; it needs a small in-app text prompt |
| CI builds **arm64-v8a only** | `.github/workflows/ios-build.yml` | Phones with 32-bit Android (many Android Go and old budget phones) can't install Lens |
| Thermal status needs API 29+ | `modules/lens-device` | Android 7–9 phones get no heat signal; fall back to battery temperature |
| Live upload finds the recording by listing `<cache>/Camera` | `src/lib/live-upload.ts` | Our own recorder should hand over the exact file path instead |
| HEIC decoding needs API 28+ | (editing iPhone photos on Android) | Android 7–8 can't open HEIC originals; edit from the preview there |
| Phone sensors go up to 50–200 MP; budget GPUs allow 4096–8192 px textures and have little RAM | (export) | Full-resolution renders must be **tiled**, never one big bitmap/texture |
| `expo-camera` already pulls in CameraX 1.6.0 (min SDK 24, target 36) | `node_modules/expo-camera` | No new camera dependency; the expo-camera lag patch stays for `BasicCamera` |

## 2. Approaches considered

**Camera**
| Option | Pros | Cons |
|---|---|---|
| A. Keep expo-camera and patch it further | Least work | No manual controls, no frame pipeline, patch debt grows |
| **B. CameraX + Camera2 interop (recommended)** | Google's per-device quirk fixes across thousands of models; manual ISO/shutter/WB/focus through `Camera2Interop`; OEM **Extensions** (Night, Bokeh, HDR); RAW and Ultra HDR capture; `Recorder` for video | Some Camera2 features need care through the interop layer |
| C. Raw Camera2 only | Maximum control | We'd own every device quirk (session configs, orientation, OEM bugs); fragile on the long tail of budget phones |

**Imaging (looks, editor, export)**
| Option | Pros | Cons |
|---|---|---|
| **OpenGL ES 3.0 shaders (recommended)** | Runs on effectively every Android 7+ phone; one shader set for viewfinder, editor, photo export and video export | We write the pipeline ourselves |
| AGSL / RenderEffect | Simple | Android 13+ only, which rules out older phones |
| RenderScript | — | Deprecated |
| react-native-skia | Same shaders on iOS and Android | Big dependency, not usable in the camera frame path |

## 3. Proposed architecture

```
modules/lens-camera/
  android/…/lenscamera/
    LensCameraModule.kt       same props/events/functions as iOS
    CameraController.kt       CameraX binding, Camera2 interop, capture
    DeviceProfile.kt          capability probe → tiers (below)
    gl/GlPipeline.kt          EGL + shaders, shared by preview/editor/export
    gl/LookLut.kt             bakes each look to a 33³ LUT (cached)
    night/NightMerge.kt       align + merge burst (fallback when no OEM Night)
    portrait/Segmenter.kt     subject mask (fallback when no OEM Bokeh)
    imaging/LensImagingModule.kt  renderImage (tiled), exportVideo (Media3), hasDepth
    imaging/LensEditView.kt   live editor preview
```

**Viewfinder:** CameraX `Preview` goes through a `CameraEffect` (GL) targeting the
preview only, so the photo itself stays untouched. One GL pass does the live look
(a single LUT lookup) and the monitors (zebra, peaking, false colour). The histogram
comes from a 64×48 read-back of the same texture 4 times a second. That means **no
extra ImageAnalysis stream**: a third stream was what caused the earlier Android lag.

**Looks stay identical across platforms:** each look becomes a small list of colour
operations (gain, curve, split tone, saturation, vibrance, contrast) in one shared
spec. Android bakes each to a 33³ LUT once; the editor and exports apply the same
LUT plus the adjustments shader. Apple's built-ins (Noir, Chrome, Instant) are
matched with explicit curves, compared against iOS reference renders from the macOS
CI runner. Later, iOS can use the same LUTs too.

**Capability tiers** come from `CameraCharacteristics`, with hardware level, capabilities,
ranges and extensions queried per camera:

| Feature | Best (flagships) | Fallback | Last resort |
|---|---|---|---|
| ISO / shutter | `MANUAL_SENSOR`: real ISO and exposure time | — | Hidden; EV only (works everywhere) |
| White balance | `MANUAL_POST_PROCESSING`: Kelvin + tint mapped to RGGB gains | AWB presets (daylight, cloudy, shade, tungsten, fluorescent) snapped from the dial | Auto |
| Focus | Manual distance in calibrated diopters | Tap to focus | Fixed-focus cameras: hidden |
| Lenses | Logical multi-camera: 0.6× / 1× / 2× / 5× from physical focal lengths via zoom ratio | Separately exposed back cameras grouped by focal length | Digital zoom |
| Night | OEM **Night extension** (Samsung, Xiaomi, OPPO, vivo, Honor and others) | Our burst: 4–8 frames, aligned and merged on GPU; frame count by tier and heat; tripod-aware (gyro still → longer exposures) | Single long-ish exposure + noise reduction |
| Portrait | OEM **Bokeh extension** (real depth) | Subject mask from Google Play services ML, blurred by the mask; adjustable in the editor like iOS | Hidden |
| RAW | DNG (CameraX 1.5+ RAW / RAW+JPEG) on `RAW`-capable cameras | — | Hidden |
| HDR photo | **Ultra HDR JPEG** (Android 14+) | Standard JPEG | — |
| Video | 4K/1080p with quality fallback; 10-bit HLG where `DynamicRange` allows; 60 fps where ranges allow; stabilization | 1080p/720p | — |

Photos stay in the camera's own format (JPEG / Ultra HDR / DNG). They're never
re-encoded to HEIC, since originals must stay untouched.

**Editor and exports:** `LensEditView` renders a screen-size proxy on GL. `renderImage`
decodes with `ImageDecoder` / `BitmapRegionDecoder` and renders in **overlapping tiles**,
so 200 MP works on a 3 GB phone. It writes JPEG (or HEIC via `HeifWriter` where a hardware
encoder exists) and copies the EXIF. `exportVideo` uses **Media3 Transformer** with our
GL shader as an effect (handles codec quirks and HDR).

**Video and live upload:** the CameraX `Recorder` writes MP4 through MediaMuxer to a path
we choose. That's the same append-only behaviour `LiveUpload` relies on, so live upload
keeps working, and the native side passes the exact path.

**Heat and battery:** a fixed 30 fps preview; one GL pass; monitors update at 4 Hz; heavy
work happens only after the shutter, on a background thread. When the phone is warm:
fewer Night frames, no live looks or monitors (already wired through `isHot`). Android
7–9: battery-temperature fallback for the heat level.

**Compatibility:** build `armeabi-v7a` as well as arm64 (per-ABI APKs for sideloading,
an AAB for Play). Keep `BasicCamera` for Expo Go and as a safety net when the pro
camera fails to open. Add a "Camera info" screen in Settings that shows the detected
tiers and can be shared, to debug users' phones remotely.

## 4. Android-only additions (cheap, useful)
- Register Lens as a camera app: double-press power / lock-screen launch
  (`STILL_IMAGE_CAMERA`, `SECURE_STILL_IMAGE_CAMERA`) and a Quick Settings tile.
- Volume keys as the shutter.
- Ultra HDR photos on Android 14+ screens.
- OEM HDR / Auto extensions where they exist.
- Tripod-aware Night.

## 5. Build order (each phase tested before the next)
0. Module scaffold, capability probe + "Camera info" screen, 32-bit build, preset-prompt fix.
1. Pro camera core: preview, photo, video + live upload, lenses/zoom, focus, EV, flash/torch, timer.
2. GL viewfinder: live looks + monitors.
3. Manual controls (tiered), stats read-back, RAW, presets, HDR/fps/stabilization video.
4. Imaging engine: looks, adjustments, crop, auto, editor, tiled export, video export.
5. Night (OEM → own merge).
6. Portrait (OEM Bokeh → ML mask, editable blur).
7. Android additions (section 4).

## 6. Testing
- Kotlin unit tests for pure logic (tier mapping, Kelvin↔gains, LUT baking, tile planner,
  alignment) in CI.
- Local builds plus the Android emulator (API 34, virtual camera) for smoke tests.
  This needs a JDK and Android build-tools installed in `~` (no sudo).
- Real phones: the user's Android phone. Optionally Firebase Test Lab's free tier
  (5 real-device runs/day across brands) to catch device-specific crashes.
- Cost: no new cloud resources, since everything runs on the phone.
