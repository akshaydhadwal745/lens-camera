# Capture modes and video options

**Where:** Pro camera (iPhone/iPad app build). **Code:**
`modules/lens-camera/ios/CameraController.swift`, `LensCameraView.swift`,
`src/components/pro/ProCamera.tsx`.

## Live looks in the viewfinder

Pick a look in the strip above the lens buttons — the viewfinder shows it live.
Tap the selected look again for an **intensity** dial (0–100%).

- New shots get the look as a **removable edit** (the original is saved untouched).
  See [looks-and-editing.md](looks-and-editing.md).
- **Save looks into the file** (MONITOR sheet) makes it permanent instead:
  photos are re-rendered right after capture (fast); videos are **re-encoded
  after recording** (takes a while and uses battery — off by default).
- How it works: frames from the camera are rendered on the GPU through a 33³
  colour lookup table (LUT) into a Metal view drawn over the normal preview at
  30 fps. If the phone can't deliver frames (some devices can't record and
  analyse at the same time), the plain preview is shown and the look still
  applies to the shot.

## Night mode

For dark scenes. Press the shutter and **hold still for about a second**: the
camera takes a burst (2–8 frames, default 6, set in MONITOR), aligns them
(Apple Vision), averages them to remove noise, applies light noise reduction,
and saves one HEIC. Works with auto or manual exposure — a slower manual
shutter on a steady surface gives the cleanest result. Flash and RAW are off in Night mode.

Limits: moving subjects can ghost; Apple's own Night mode isn't available to
third-party apps, so this is Lens's own implementation.

## Portrait mode

Uses the dual camera (back) or TrueDepth camera (front) to capture **depth**
with the photo. The background blur is an adjustable edit, not baked in:
change it later in the editor (f/1.4 strong … f/16 none). Default blur is set
in MONITOR. Lens buttons are hidden in Portrait mode. If the phone has no depth
camera, photos are taken normally.

## Video options

| Option | Where | Notes |
|---|---|---|
| Resolution 4K / HD | Top bar | |
| Frame rate 24 / 30 / 60 | Top bar | 60 only if the camera supports it at that resolution |
| HDR | Top bar | 10-bit HLG (Dolby Vision–compatible) when supported; off when Log is on |
| Apple Log | Top bar | iPhone 15 Pro and newer; flat profile for colour grading |
| Stabilization | MONITOR | Off / Standard / Cinematic (default) / Extended; falls back to the best supported |
| Torch | Top bar | |

If a requested combination isn't available, the camera says so and uses the
closest setting.
