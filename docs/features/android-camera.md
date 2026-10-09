# Android camera, looks and editor

**Where:** the Android app (`Lens.apk`). Same screens as iPhone: the pro
camera, looks, Night, Portrait and the editor. Design and reasoning:
[design/android-camera.md](../design/android-camera.md).

**Code:** `modules/lens-camera/android/` (Kotlin), same JS API as iOS
(`modules/lens-camera/index.tsx`).

## Works on any Android phone, shows only what it can do

Lens reads what each camera supports and shows only those controls. On a phone
that can't do something, the control isn't there, rather than shown and broken.

| Feature | Best phones | Fallback | Oldest / cheapest phones |
|---|---|---|---|
| ISO / shutter | Real manual ISO and shutter speed | — | Hidden; EV (brightness) still works |
| White balance | Kelvin dial (exact colour gains) | Dial snaps to presets (daylight, cloudy, shade, tungsten, fluorescent) | Auto |
| Focus | Manual focus dial | Tap to focus | Fixed-focus cameras: hidden |
| Lenses | 0.6× / 1× / 2–5× buttons (one "logical" camera) | Separate back cameras grouped by zoom | Digital zoom |
| Night | The phone maker's own Night mode (Samsung, Xiaomi, OPPO, vivo, Honor…) | Lens Night: 4–8 shots aligned and merged | Same, fewer shots |
| Portrait | Person found by on-phone ML, blur adjustable later | — | Same (model is inside the app) |
| Video | 4K, 60 fps, 10-bit HDR, stabilization where supported | Each option is dropped one by one if the phone refuses the combination | 1080p/720p |

**Settings → Camera info** shows what Lens detected on this phone (camera
level, lenses, ISO/shutter ranges, video sizes) and can be shared. Use it
when a user reports a missing feature.

If the pro camera can't start at all on a phone, Lens switches to the basic
camera for that session instead of showing a black screen.

## Viewfinder

The camera feed is drawn with OpenGL ES 2.0 (works on every Android 7+ GPU,
including old budget ones). One pass per frame does the live look and the
monitoring overlays (zebra, focus peaking, false colour); the histogram comes
from a tiny 96×72 copy read 4× a second. There is **no extra camera stream**:
a third stream was what made the old Android camera lag. Preview runs at a
steady 30 fps. If OpenGL fails on a phone, the plain CameraX preview is used
(no live looks, everything else works).

**Rotation:** CameraX reports how far the raw sensor image must turn to be
upright. When the camera writes straight into our SurfaceTexture, some phones
(e.g. Galaxy S8) already put the sensor rotation into the buffer transform, so
`GlPreview` combines CameraX's rotation with the angle read from the
SurfaceTexture matrix (on the S8, ignoring it was 90° off and subtracting it
180° off; adding it is upright). Tap-to-focus keeps the full
rotation (raw buffer coordinates). The log line `first frame … rotation R (st S)`
shows both values.

## Night (Android)

- **Maker's Night mode** (CameraX Extensions) when the phone has one: a single
  press, the phone does its own processing.
- **Otherwise Lens Night:** 4 (basic phones), 6 (standard) or 8 (pro) quick
  shots. Lens picks the sharpest as the reference, aligns the others to it,
  averages them in bands (little memory, any photo size), skips anything
  that moved (no ghosts), and gently lifts dark scenes. Noise drops by about
  √N (8 shots ≈ 3× less noise). A hot phone takes at most 3 shots.
- Hold still until "Hold still…" disappears.

## Portrait (Android)

The person is found by ML Kit's selfie segmentation. The model is **inside the
app** (about 5 MB), so it works without Google Play services and offline. The mask
is saved **inside the photo's JPEG** (an extra APP9 "LENSMASK" segment; the
photo's pixels and EXIF are untouched), so it travels to the cloud and other
phones. The blur is an edit: change it or turn it off in the editor
(f/1.4 strong … f/16 none). If nobody is in the frame, the photo is normal.
Works with the front and back cameras. People only; pets and objects aren't detected.

## Looks and editor (Android)

- The 13 looks are colour lookup tables (33³). Same names and recipe as iOS.
  Exact iOS-matching tables are baked on the macOS CI runner
  (`modules/lens-camera/tools/bake-looks/main.swift`, artifact `looks`) and
  bundled in `android/src/main/assets/looks/` (done 2026-10-09, 324 KB), so
  looks match iOS exactly. `LookLut.kt` is the fallback if an asset is missing.
  Re-copy the artifact whenever `Looks.swift` changes.
- Editor: looks + intensity, Auto, exposure, contrast, highlights/shadows
  (by region, not flat), warmth/tint, saturation, vibrance, sharpness,
  vignette, grain, crop/rotate/flip/straighten, portrait blur.
- Big photos are rendered in **1024 px tiles**, so 50–200 MP photos work on
  phones with little memory; the size of a full export is capped by available memory.
- Exports and "Save looks into the file" write **JPEG** on Android (HEIC
  encoding isn't on every phone). EXIF (date, place, camera settings) is kept.
- Video looks: re-encoded with Media3 Transformer (hardware codecs, audio
  copied). HDR videos are tone-mapped to normal video first.

## Photo quality (Android)

- **JPEG quality 95** in every mode (CameraX would use 85 for quick captures).
- **Ultra HDR** (Android 14+ phones that support it, on by default, **HDR**
  button in Photo mode): a normal JPEG plus an HDR "gain map", so highlights
  and shadows show their full range on HDR screens. Other screens see a normal JPEG.
- **RAW (DNG)** on cameras that support it (**RAW** button in Photo mode).
  The unprocessed sensor data, for editing elsewhere; previews are made by Lens's
  imaging engine.
- Night is merged at **full resolution** on every phone.
- If a phone refuses Ultra HDR or RAW when the camera starts, it falls back to plain JPEG.

## Not yet on Android

- The Kelvin readout in auto mode is an estimate; the dial itself is anchored
  on the phone's own auto white balance, so switching to manual doesn't jump.

## Testing

- `cd modules/lens-camera/android` tests run with Gradle:
  `./gradlew :lens-camera:testReleaseUnitTest` (from `android/` after prebuild).
  32 unit tests: colour temperature, LUTs, crop geometry, tone, JPEG mask, night alignment.
- Emulator (API 34, virtual camera scene) verified: viewfinder, live looks,
  histogram, photo with look, editor (looks, rotate, square crop, straighten),
  saved edit, Night merge (moving object, no ghosts), video recording,
  Portrait capture (no person in scene → normal photo).
- Not yet run on a real phone.

## APKs

CI builds `Lens.apk` (64-bit, almost every phone) and `Lens-32bit.apk` (phones
whose Android is 32-bit, e.g. Android Go and older budget phones).
