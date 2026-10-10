# Simple camera (default) + Pro

Lens decides the technical things itself; the screen shows only what everyone
needs. Product principle: an intelligent camera, not a feature-heavy one
(advanced controls only when genuinely needed).

## Simple (default, `pro: false`)

- Top: flash (photo/portrait) or torch (video), and **PRO**.
- Viewfinder, zoom badge, **automatic Night badge** in low light.
- Lens chips (0.6× / 1× / 2×…), modes **VIDEO · PHOTO · PORTRAIT**, gallery,
  shutter, flip.
- Everything else is automatic (`effectiveSettings` in `src/lib/pro-camera.ts`):
  exposure, white balance, focus, Ultra HDR where the phone has it, 30 fps video,
  no RAW / LOG / HDR video / timer / looks while shooting / monitors / grid.
  Looks are applied after the shot in the editor.

### Automatic Night

`isLowLight` (hysteresis): on at ISO ≥ 1250, or 1/15 s at ISO ≥ 640; off once
ISO ≤ 800 and faster than 1/20 s. While on, Photo shows a yellow **Night** badge
and the shutter takes a 4-frame merged shot (`AUTO_NIGHT_FRAMES`, "Hold still…").
Tapping the badge turns it off for this session ("Night off"). Thresholds are a
first guess; the Quality Lab / self-test data will tune them.

## Pro (`pro: true`, the PRO button)

Today's full controls, unchanged: manual ISO / shutter / WB / focus dials, EV,
RAW, Ultra HDR toggle, 4K/HD, LOG, HDR video, fps, timer, looks while shooting,
monitoring (histogram, peaking, zebra, false colour, level, grid, crop guides),
presets, and the Night mode button. The user's pro settings are saved
separately and come back when Pro is switched on again.
