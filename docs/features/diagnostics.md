# Camera diagnostics (Android)

Anonymous reports of how the camera started on each phone, so problems show up
on phone models we can't test ourselves (the Galaxy S8 1.5 MP photo bug would
have been visible on day one). Shipped in dev-35.

## What is sent

`src/lib/diagnostics.ts` → `POST /v1/diagnostics` → `s3://<media bucket>/diag/<day>/<maker_model>/<time>-<random>.json`
(no account link; deleted after 365 days by a bucket lifecycle rule; listed in
the privacy policy, section 1).

| Event | When | Details |
|---|---|---|
| `camera` | camera bound (`onReady`) | position, lens, mode, **photoSize vs maxPhotoSize**, previewSize, photo format, extension, hardware level, tier, bindAttempt (0 = no fallback) |
| `preview` | first SurfaceRequest transform info | cameraTransform (which rotation rule ran), mirroring, rotationDegrees, targetRotation, buffer size |
| `glFallback` | OpenGL viewfinder failed → plain preview | message |
| `fallbackBasic` | pro camera fatal → basic camera | message |
| `cameraError` | non-fatal camera error | message |
| `basicPhoto` | photo taken with the basic camera | saved size |
| `capabilities` | **once per app build**, after the first camera start (2026-10-12) | the full camera report (Camera info / `deviceReport`): every camera's lenses, megapixels, hardware level, streams, ISO/shutter range, extensions, feature probes (slow motion, 60 fps, photo while recording, low-light boost, face priority, stabilization, ZSL, time-lapse profiles) and video encoders; 3–8 KB. Sent so every phone that installs Lens reports what it can do, not only the phones we test. Retried on the next app start if offline |
| `selftest` | self-test run (Settings, Test Lab, Device Farm) | every step with status, message and details (photo sizes, capture ms, previewStats, video file stats…); the camera report is left out (sent as `capabilities`) |

Each report is sent at most once per day per app build (dedupe file
`Documents/diagnostics-sent.json`), batched 4 s after the camera settles. Every
failure is swallowed: diagnostics never affect the app.

Device fields: manufacturer, brand, model, Android version and API level. App
build: `buildInfo()` (APK and JS build numbers, commit).

## Reading them

```
research/.venv/bin/python research/diagnostics.py          # sync last 14 days + per-model summary
research/.venv/bin/python research/diagnostics.py --capabilities          # + one line per model: what its cameras support
research/.venv/bin/python research/diagnostics.py --days 1 --selftest 68  # every self-test step of build 68
```

Flags `⚠ photo smaller than the camera offers` when the bound photo is under
90 % of the largest JPEG size.
