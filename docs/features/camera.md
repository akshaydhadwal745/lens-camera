# Pro camera

**Where:** iPhone/iPad, in the Lens app build (SideStore / TestFlight). Expo Go
and Android show the [basic camera](#basic-camera) instead.
**Code:** `modules/lens-camera/ios/` (native, Swift / AVFoundation),
`src/components/pro/` (screen and controls), `src/lib/pro-camera.ts` (settings, presets).

## Layout

- **Top bar:** flash (photo/portrait) or torch (video) · RAW/ProRAW (photo) ·
  resolution, HDR, frame rate, LOG (video) · timer · MONITOR · PRESETS.
- **Top left:** current zoom (lens factor × zoom); a spinner shows while focus/exposure adjusts.
- **Top right:** live histogram.
- **Bottom:** manual dial (when a control is selected) → manual controls row →
  looks strip → lens buttons → modes (NIGHT · VIDEO · PHOTO · PORTRAIT) → gallery, shutter, flip.

## Manual controls

Tap a control to open its dial; drag the ruler to change it; tap **AUTO** (or
long-press the control) to give it back to the camera. Controls in auto show what
the camera is currently doing ("ISO A 125").

| Control | Range | Notes |
|---|---|---|
| ISO | Camera's min…max, standard stops | Switching to manual keeps the current shutter so the image doesn't jump |
| Shutter | 1/8000 … 1 s, standard stops | Manual exposure = ISO + shutter |
| WB (white balance) | 2000 … 10000 K | Tint is kept at the current value |
| Focus | Near … ∞ | Focus peaking turns on automatically while adjusting |
| EV | −3 … +3 in ⅓ steps | Exposure compensation (auto exposure only) |

Tap the preview to focus/expose on a point. Pinch to zoom.

## Lenses

Buttons for each back lens the phone has (e.g. **.5×**, **1×**, **3×**); the
factor is measured from the lenses' field of view. iPhone 12 has .5× and 1×.
Portrait mode uses the dual camera and hides lens buttons.

## Formats

- **Photos:** HEIC by default (about half the size of JPEG at the same quality),
  JPEG fallback; **RAW** saves a DNG (ProRAW on Pro models). RAW photos skip
  "bake" so they stay raw.
- **Video:** HEVC, 4K or 1080p; HDR, 24/30/60 fps and stabilization — see
  [capture-modes.md](capture-modes.md).

## Monitoring (MONITOR sheet)

| Tool | What it shows | Use it for |
|---|---|---|
| Histogram | Brightness distribution; left/right markers turn blue/red when shadows crush or highlights clip | Checking exposure at a glance |
| Focus peaking | Red outline on sharp edges | Manual focus, macro |
| Zebra stripes | Stripes over areas above 70/90/95/100% brightness | Avoiding blown skies, faces, white clothes |
| False color | Purple/blue = very dark · green = mid-grey · pink = skin tone · yellow/red = clipping | Exposing skin and scenes precisely |
| Level | Line that turns yellow when the phone is level | Horizons, architecture |
| Grid | Rule of thirds or centre cross | Composition |
| Crop guide | Masks outside 1:1, 4:5, 16:9, 2.39:1 | Framing for Instagram, stories, cinema |

The monitoring tools run on small, downscaled frames ~12 times a second to keep
the phone cool.

## Presets

Built in: **Daylight**, **Night**, **Cine** (2.39:1, 24 fps-style shutter, Log,
zebras), **Focus check** (manual focus + peaking). **Save current settings…**
stores your own (exposure, white balance, focus, formats, look, monitoring); long-press to delete.
The camera also remembers its last settings.

## Basic camera

Expo Go / Android: photo and video, flash, pinch zoom, grid, 3/10 s timer, front/back.
Uses `expo-camera`; photos are JPEG.
