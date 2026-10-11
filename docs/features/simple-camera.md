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
