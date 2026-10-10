# Camera self-test (Android)

One automated pass through everything the camera does on this phone, with a
pass/fail per step. Runs:

- **On any phone:** Settings → Camera info → Run self-test (about a minute;
  rotates the screen to landscape and back; test photos are deleted).
- **On real phones in Firebase Test Lab** as a "game loop": Test Lab launches
  Lens with `com.google.intent.action.TEST_LOOP` (intent filter added by
  `plugins/with-test-loop.js`); `src/app/index.tsx` redirects to `/selftest`,
  which runs, writes Test Lab's result file, sends the report and closes.
  `scripts/testlab.sh <build> [model/version …]` starts it and prints every
  phone's result (32-bit phones: `model/version:32` uses Lens-32bit.apk).

## Steps (`src/lib/self-test.ts`, planned from the phone's capabilities)

| Step | Pass when |
|---|---|
| Back camera photo | photo saved; ≥ 90 % of the largest JPEG = pass, 50–90 % = warn (e.g. Pixel 8a keeps 12 of 16 MP: 16 MP isn't guaranteed with a live preview), < 50 % = fail (the S8 bug: 1.5 of 12 MP). Maker modes only warn (their own sizes) |
| Landscape / other landscape / back to portrait | preview re-binds for the forced screen rotation (`targetRotation` 1/3, then 0), photo still full size |
| Every other back lens (0.6×, 2×…) | photo full size for that lens |
| Front camera photo, front landscape | as above (mirroring + preview path recorded) |
| Night | merged photo saved (4 frames), full size |
| Portrait | photo saved; no mask = warn (needs a person in view; test-rack phones see none) |
| Video (3 s) | file > 0 bytes, duration ≥ 2 s |
| RAW | DNG saved (phones with RAW) |
| Plain JPEG | phones without Ultra HDR |
| Maker AUTO / HDR / NIGHT | binds and saves (skipped where the phone lacks it) |
| Upload (Test Lab only) | photo confirmed in the cloud through the real upload queue within 2 min |

Photo orientation itself follows the motion sensor, which a phone in a test
rack doesn't change, so the rotation steps check the preview path; Test Lab's
screen video shows how it looks.

Each report also goes to `POST /v1/diagnostics` as a `selftest` event
(`research/diagnostics.py` lists them).

Native hooks (lens-device): `testLoop()`, `writeTestResult(uri, text)`,
`finishTestLoop()`, `setOrientation(portrait | landscape | reverseLandscape | auto)`.

## Results

- **dev-36, 2026-10-10** (Test Lab game loop, matrix-gdecru8i9rs2a): Galaxy A14 5G
  11/12, emulators 11/12 and 10/12, Pixel 8a 5/15. Real bug found: on Android 14
  the display listener doesn't fire for a direct 180° turn, so the preview stayed
  on the old rotation (fixed in dev-37: rotation re-checked every 250 ms). The
  other failures were grading (portrait mask without a person, Pixel 16 MP limit,
  maker-mode sizes), now warnings.
