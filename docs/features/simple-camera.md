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
