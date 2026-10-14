# Normal camera (default) + Pro

Organised around what people want to do (user, 2026-10-11): **Normal is the
creative camera** (looks, portrait styles, timer), and Lens handles the
technical side itself. **PRO only adds manual controls**; it never holds the
creative features. Product principle: intelligent, simple, powerful by default.

## Normal (default, `pro: false`)

- Top: flash (photo/portrait) or torch (video), **timer**, and **PRO**.
- Viewfinder, zoom badge, **automatic Night badge** in low light.
- Tray: **looks** row (tap = live look, tap the selected one again = strength
  dial) in Photo/Video, or the **portrait styles** row (Natural · Studio · Mono ·
  Stage) in Portrait; lens chips; modes **VIDEO · PHOTO · PORTRAIT**; gallery,
  shutter, flip.
- Automatic (`effectiveSettings` in `src/lib/pro-camera.ts`): exposure, white
  balance, focus, Night (auto), Ultra HDR where the phone has it, 30 fps video;
  no RAW / LOG / HDR video / monitors / grid. The creative choices (look,
  portrait style, timer) are the user's in both Normal and PRO.

### Automatic Night

`isLowLight` (hysteresis): on at ISO ≥ 1250, or 1/15 s at ISO ≥ 640; off once
ISO ≤ 800 and faster than 1/20 s. While on, Photo shows a yellow **Night** badge
and the shutter takes a 4-frame merged shot (`AUTO_NIGHT_FRAMES`, "Hold still…").
Tapping the badge turns it off for this session ("Night off"). Flash set to
AUTO or ON wins over automatic Night (no badge then): an explicit flash choice
is respected. Thresholds are a
first guess; the Quality Lab / self-test data will tune them.

### Focus and brightness (Normal and PRO)

- **Tap**: focus and exposure at that point; a yellow box with a sun slider shows for 3 s.
- **Drag up/down** (one finger, while the box shows): brighter/darker
  (exposure compensation, 150 dp per stop, within the camera's range). A new
  tap, mode or camera resets it.
- **Long-press**: lock. The badge says what this camera could hold: `AE/AF LOCK`,
  `AE LOCK` (fixed-focus cameras) or `AF LOCK` (cameras without AE lock). Tap anywhere to unlock.

### Smart burst

Hold the shutter in Photo mode: Lens keeps shooting until you let go (up to 20),
then picks the best shot (sharpest, eyes open, smiling) and shows only that one in
your roll, marked `⧉ 12`. Open it and swipe to see the others; tap `⧉ MAKE PICK` on
another shot to show that one instead. All shots are kept and backed up.

### Straight horizons (automatic)

If a photo is taken slightly tilted (1–4°, by accident), the Normal camera
straightens it ("Horizon straightened 2°"). It's an edit: the original is kept
and you can undo it in the editor. Bigger tilts are left alone.

### Faces first (automatic)

In the Normal camera, phones whose camera can detect faces expose and focus for
the faces (Camera2 face priority): a face against a bright window stays visible.
PRO and a long-press lock use plain auto exposure.

### Look suggestion

With no look chosen, the Normal camera may suggest one that suits the scene
(sunset → Golden hour, food → Warm, snow → Cool, night → Cinematic, nature →
Vivid) as a "✦" chip at the start of the looks row. Tap it to apply; nothing
changes by itself. Uses Google's on-phone scene labels via Play services (no
suggestion on phones without them).

### Grid and level

- **Grid**: Settings → Camera → Grid (rule of thirds; off by default). PRO has its own grid/guides.
- **Smart level** (Normal): the level line appears only while the phone is within 8°
  of straight, turns yellow when level, and fades 1.5 s later. Tilt on purpose and it
  stays out of the way. PRO keeps the always-on level (toggle in MONITOR).

### Mirror selfies

Settings → Camera → **Mirror selfies** (on by default): front-camera photos and
videos are saved the way the preview showed them. Photos get a lossless EXIF
flip (the pixels stay as the sensor took them); video is mirrored in the camera
pipeline. Off saves true-to-life (text reads correctly).

### Save location (opt-in)

Settings → Camera → **Save location** (off by default). Switching it on asks for
location permission. While the camera is on screen, Lens keeps a recent position
from Android's own location service (GPS + network; no Google Play services
needed) and writes it into each photo (EXIF GPS) and video. A position older than
10 minutes is never used. Photos you share keep their location.

### Sound while recording

Lens records with the microphone setting phone makers tune for their own
camera (their wind and noise handling). If the mic gets blocked while you
record (the privacy toggle, or another app using it) or fails, the REC pill
shows **NO SOUND** right away. A wired or USB mic is used automatically
(`EXT MIC`); Bluetooth headsets aren't used, because their call-quality mic is
worse than the phone's own.

### Photo while recording

While a video records, the gallery button becomes a white photo button. Phones
that can run a photo stream next to the video give full-resolution photos;
others save the current video frame (up to the video's resolution, never
upscaled).

### Low-light video (automatic)

In the Normal camera, video in a dark place gets brighter by itself: the frame
rate may drop from 30 to 24 fps (more light per frame), and phones with
Android's low-light boost (Android 15+, where the camera supports it) use it;
the REC pill then shows `LOW LIGHT`. PRO video keeps the frame rate you chose.

### Slow motion

**SLO-MO** mode, only on phones that can do it, at the best speed each phone
offers: 240 fps (8× slower) or 120 fps (4×) where the phone maker lets apps use
high-speed video; otherwise 60 fps played at half speed (2×; the recording is
re-timed after you stop, without re-encoding, so nothing is lost). Slow-motion
clips have no sound. The REC pill shows the speed, e.g. `4× SLOW`.

### Time-lapse

**TIME-LAPSE** mode (phones whose GPU can feed the video encoder; the mode is
hidden elsewhere). Press to start and stop; Lens decides the speed itself: a
frame every 0.5 s for the first minute (15×), then 1 s (30×) up to 5 minutes,
2 s (60×) up to 20 minutes, then 4 s (120×), so 10 minutes make about a
17-second clip. Brightness changes between frames are smoothed (no flicker),
the clip is 16:9 in the way you hold the phone, 30 fps, without sound. The REC
pill shows real time → clip length.

### Pause while recording

While a video records, the flip button turns into **pause**. Paused time isn't
recorded (one file, no gap), the REC pill shows `PAUSED` and the timer stops;
tap ⏺ to continue.

### Screen stays on in the camera

Like the stock camera: while the camera is on screen the phone doesn't dim or
lock. Two minutes without a touch hands control back to the phone's own screen
timeout (battery and heat); any touch starts the two minutes again. While a
video (or hyperlapse) records the screen always stays on. Only the camera does
this: the roll, viewer and settings follow the phone's timeout.
(`useCameraKeepAwake` in `src/lib/keep-awake.ts`, using expo-keep-awake, which
ships inside expo and is resolved by `metro.config.js`, so no new APK was needed.)

### Leaving the camera mid-photo

Tapping the gallery while a photo is still being taken opens it at once and
the photo still saves: the camera finishes the capture behind the gallery, then
closes (at most 30 s later). The fallback camera (phones where the Lens camera
can't start) opens the gallery once the photo is saved. Time-lapse and hyperlapse upload while they record, like video (same
Wi-Fi / mobile-data setting).

### Shutter sound

Settings → Camera → **Shutter sound** (on by default): the phone's own camera
click when a photo really starts, and the record start/stop sounds (start plays
before the mic opens, stop after the file is closed, so neither is in the video).
Silent or vibrate mode keeps it quiet, except in countries where the law requires
a shutter sound (Android 13+ reports this and Lens always plays it there).

### Volume buttons

Volume up/down (and the camera key, and Bluetooth selfie remotes) work like the
shutter while the camera is on screen: photo, start/stop video, or cancel a
running timer. Holding the button takes one shot. On other screens the buttons
change the volume as usual (`HardwareShutter.kt`).

## Aspect ratio (checklist 9.1)

The ratio chip in the top bar cycles 4:3 → 16:9 → 1:1 (photo modes). On Android
the viewfinder is WYSIWYG: the camera picture is drawn only inside the frame that
is kept (`frame` prop on the native view, fractions of the view; black around it).
Photo modes sit just under the top controls at 4:3; video modes are centred 16:9.
16:9 and 1:1 photos keep the full 4:3 file and get a removable centred crop in
the edit recipe, so the shape can be undone in the editor. Grid and crop guides
are drawn inside the frame.

## Motion photos (checklist 9.2)

**MOTION** in the top bar (Photo mode, Android phones whose GPU viewfinder can
feed a video encoder; off by default). While on, the viewfinder is encoded all
the time (H.264, 1280×960 or the 4:3 shape that fits, 30 fps, key frame every
second, `gl/MotionClip.kt`) and only the last ~2 s stay in memory. A shot keeps
1.5 s before and 1.5 s after the press; the photo is ready ~1.5 s after the
shot (the shutter is busy until then).

The clip is joined to the JPEG in Google's **Motion Photo** format
(`imaging/MotionPhoto.kt`): XMP `Camera:MotionPhoto` + a `Container:Directory`
listing the video's length, MP4 appended after the image. Ultra HDR photos keep
their gain map (the video is listed after it). Google Photos plays it; any other
app just sees the photo. In Lens the viewer shows **▶ MOTION** on photos taken
on this phone; it plays the clip once, muted (`LensImaging.motionVideo` extracts
it into the cache).

Limits: no sound; ~+1.5 MB per photo (counts toward storage/upload, hence off by
default); not with RAW, Night, Portrait, burst or "bake looks"; the cloud copy
keeps the clip but only the phone that took it shows ▶ MOTION for now.

## QR codes (checklist 9.3)

Photo mode (Normal and PRO, Android) looks for QR codes a couple of times a
second (ML Kit barcode scanning, the bundled library expo-camera already ships,
on a sharp ~640 px copy of the viewfinder: `gl/QrScanner.kt`). A code shows
after two reads in a row and goes after three misses (no flicker at the edge).
One glass chip near the bottom of the frame says what a tap does:
**host · Open** (web links only, `http(s)`), **Wi-Fi name · Copy password**,
**number · Call**, **address · Email**, anything else **· Copy**. Other link
schemes (intent:, javascript:, app links) are never opened, only copied.
Settings → Camera → **Scan QR codes** (on by default).

## Document scanning (checklist 9.4)

**SCAN** at the end of the mode strip (Android phones with Google Play
services). It opens Google's ML Kit document scanner (`imaging/DocumentScan.kt`,
`play-services-mlkit-document-scanner`, downloaded by Play services on first use,
nothing bundled): it finds the page edges, flattens the perspective, and offers
its clean-up filters (shadows, stains, fingers), up to 20 pages. Each page comes
back as a JPEG and goes into the roll as a photo (backed up like any photo).
Cancel = nothing saved. Phones without Play services don't show SCAN.

## Hyperlapse (checklist 9.5)

No separate mode: **TIME-LAPSE** notices when the phone is being carried
(`HandMotion.kt`: gyroscope turning speed averaged over ~2 s, accelerometer
jitter on phones without one; moving above 0.15 rad/s, still again below 0.07).
While carried, frames are taken every 267 ms (8×; 16× after 5 minutes) instead
of the tripod schedule (15×→120×), so walking stays smooth instead of jumping;
REC shows **· HYPERLAPSE** and the clip-length estimate follows. Time-lapse
also turns on the phone's **preview stabilization** where CameraX reports it
(the frames come from the preview, so this steadies the clip). No software
stabilization yet (gyro-based crop smoothing is a later step if phone tests
show shake on phones without preview stabilization).

## Astro (checklist 9.6)

No separate mode: **Night** (auto Night in Normal, Night mode in PRO) becomes
**Astro** when the phone is held still (accelerometer jitter under ~0.006 g for
2 s: tripod, wall, propped up) and the scene is very dark (auto exposure at ISO
1600+ and 1/15 s or slower), on cameras with manual exposure that allows ≥ ½ s
(`CameraController.astroPlan`, the arithmetic in `planAstro`, unit-tested).
The Night pill then reads **Astro 16s**.

Each frame gets about twice the light auto exposure was giving (dark skies are
left dark by auto exposure), at most ISO 800 and at most 4 s per frame; frames
add up to ~16 s (4–12 frames). They're aligned and stacked by the Night merge
(`NightMerge`), so noise drops by ~√N. A countdown shows while it shoots; the
camera returns to auto exposure afterwards. The maker's own Night mode (where
bound) is not replaced. Not yet: star-tracking alignment (stars drift ~0.25°/min,
fine over 16 s), focus locked at infinity.

## Motion photos on slow encoders

If even the smallest motion clip can't be encoded smoothly (seen on the
emulator's software encoder, ~0.4 fps at any size), the encoder stops (battery)
and the camera says "Motion photos aren't smooth on this phone · turned off".

## Pro (`pro: true`, the PRO button): manual controls only

Normal + the technical layer: manual ISO / shutter / WB / focus dials and EV,
RAW, Ultra HDR toggle, 4K/HD, LOG, HDR video, fps, the Night mode button with a
frame count, monitoring (histogram, peaking, zebra, false colour, level, grid,
crop guides), and presets. The user's pro settings are saved separately and
come back when PRO is switched on again.

## Selfie flash (front camera)

Front cameras without a flash use the **screen** as the flash: CameraX's
`ScreenFlashView` (added over the whole window by `LensCameraView`) turns the
screen white at full brightness during the shot (`ImageCapture.FLASH_MODE_SCREEN`).
The flash button shows on the front camera too (`screenFlash` capability).
ON = always; AUTO = only in low light (native `isDark()`: ISO ≥ 800, or ≥ 1/20 s
at ISO ≥ 400); OFF = never. Phones with a real front flash use it as usual.
