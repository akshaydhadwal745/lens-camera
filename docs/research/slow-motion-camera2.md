# Slow motion on phones CameraX can't drive (Galaxy S8 class)

**Finding (2026-10-21):** the S8's back camera advertises Camera2 constrained high-speed video
(`1280x720`: 120 and 240 fps), but its `/system/etc/media_profiles.xml` has no high-speed
camcorder profiles (only `low/high/qcif/qvga/480p/720p/1080p` and time-lapse ones). CameraX's
`HighSpeedVideoSessionConfig` needs those profiles, so it reports no slow motion and Lens hides
SLO-MO. Samsung's own camera uses a private route.

## Plan: our own high-speed recorder (Tier A2), used only where CameraX reports none

1. **Probe** (FeatureProbe): `SCALER_STREAM_CONFIGURATION_MAP.highSpeedVideoSizes` /
   `getHighSpeedVideoFpsRangesFor(size)` → offer SLO-MO with "Camera2" as the route.
2. **Recorder** (`HighSpeedRecorder.kt`): unbind CameraX, open the camera with Camera2,
   `createConstrainedHighSpeedCaptureSession` with exactly two surfaces of the same size
   (viewfinder SurfaceTexture at 1280×720, MediaCodec input surface), repeating request from
   `createHighSpeedRequestList` at [120,120] or [240,240].
3. **Encoder:** H.264 1280×720, KEY_FRAME_RATE = capture fps, KEY_CAPTURE_RATE; muxer timestamps
   stretched ×(fps/30) → a 30 fps file that plays 4× / 8× slower (no audio: as Tier A).
4. **Back to CameraX** on stop (rebind the normal session).
5. **Self-test step + S8 test:** clip length = 3 s × factor, 30 fps file, viewfinder smooth,
   orientation, heat; Test Lab tiers to make sure phones with CameraX high speed keep that route.

Risks: some Samsung HALs advertise high-speed but reject third-party sessions (session config
fails) → the probe must open a test session once and remember the answer per phone model; the
GL viewfinder must accept a 720p high-rate SurfaceTexture. Effort: about 2 days including tests.
