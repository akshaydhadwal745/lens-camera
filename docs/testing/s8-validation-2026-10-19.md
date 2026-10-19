# Galaxy S8 validation — 2026-10-19

Real-phone pass over the camera checklist and the app features on the user's
Galaxy S8, builds dev-131 → dev-136. Every result below is checked against the
real output (saved file, EXIF, cloud copy, camera request, logcat), not the UI
alone. Evidence files: `test-results/dev-131|134|136/` and the session scratchpad.

## Device

| | |
|---|---|
| Model | Samsung SM-G950F (Exynos 8895), Android 9 / API 28, 3.7 GB RAM |
| Storage | 54 GB, 96 % full (2.3 GB free) at the start |
| Back camera | Camera2 FULL, 12.2 MP, OIS, RAW, manual sensor, ISO 50–1250, shutter 1/16667–1/10 s, EV ±2 in 0.5 steps, 720p 120/240 high-speed (Camera2 only) |
| Front camera | LIMITED, 8 MP (3264×2448) |
| Encoders | H.264 up to 4K60, 1080p120, 720p240 |

## Bugs found and fixed

| # | Severity | Bug | Cause | Fix (build) | Verified |
|---|---|---|---|---|---|
| B3 | high | PRO manual ISO/shutter had no effect (ISO 1250 shown, photo at ISO 320) — on every Android phone since the Android pro camera | CameraX 1.6 runs on camera-pipe, whose 3A state writes `CONTROL_AE_MODE` over Camera2 interop options; `TorchControl` writes "AE on" on every bind and every `enableTorch` | `PipeAe.kt`: preferred AE mode on the camera's `State3AControl` + torch-off call (CameraX's own route); `enableTorch` only on change (dev-133) | EXIF ISO 1250 / 50, shutter 1/250 s; back to auto → AE on |
| B2 | medium | Long-press "AE/AF LOCK" didn't hold exposure | same: camera-pipe owns `CONTROL_AE_LOCK` | lock freezes the settled ISO/shutter as manual exposure; EV drags move it in the camera's steps (dev-133/134) | request: AE off at the settled values; unlock → AE on |
| B4 | high | Portrait photo saved with no mask, although the live blur worked | `refine()`: on this phone's runtime `max(w, h)` came out 0 (the dex is correct) → band 0 → 0/0 NaN → `roundToInt` threw → whole mask dropped | coarse-mask fallback + NaN-safe blend (dev-133); long side by plain comparison, band ≥ 1 px (dev-136) | dev-133: blurred preview; dev-136: refinement runs (no NaN log), self-test portrait pass |
| B9 | high (privacy) | Previews/thumbnails of **edited** photos carried the exact GPS to friends, share-link visitors and event guests, with "Include where they were taken" off | the imaging engine copies capture EXIF into every render (right for exports, wrong for previews) | derivatives written without EXIF/XMP: `src/lib/jpeg-meta.ts` (dev-135, OTA) | new photo: original gps=yes, preview/thumb gps=no. **34 existing objects (3 accounts) still carry GPS — cleanup script ready, needs the user's OK** |
| B5 | medium | Photos lost location after 10 min with the phone in one place | 10 m distance filter → no new fix; fixes older than 10 min are refused | no distance filter (dev-134) | camera open 11.5 min untouched → photo has GPS |
| B6 | medium | In an ordinary 50 Hz room the auto path stayed on best quality after any dim moment; bursts rebuilt the camera twice (1–3 shots per hold), single shots ~0.35 s slower | "bright" needed ≤ 1/30 s and ISO ≤ 400; rooms sit at 1/25 s, ISO 400–640 | bright = ≤ 1/25 s, ISO ≤ 640 (Quality Lab: quick = best quality at ISO 160/400/500) (dev-134/136) | self-test: auto lag 1039 → 694 ms, first burst shot 1.5–1.7 → 0.78 s, bursts pass |
| B10 | medium | Share links on `d13kuzzim5hg3c.cloudfront.net` open Chrome, not Lens, even with Lens installed | `linkUrl` used `CDN_DOMAIN` | `WEB_ORIGIN` (lens.instagrowapp.com) — **committed, needs `cdk deploy`** (diff: Api + Maintenance code only) | `lens.instagrowapp.com/s/` resolves to Lens (App Link verified), cloudfront → Chrome |
| B1 | low | EV label +0.8 while +1.0 applied | label not snapped to the camera's 0.5 EV step | `evStep` capability + snapped label (dev-133) | label "+0.5" |
| B7 | low | Free-up-space dialog promised a system confirm + trash (Android 9/10 deletes at once); "1 imported photo and video"; "Something went wrong" for a denied permission | copy | platform-aware text, counts, "Photos access needed" (dev-134) | |
| B8 | low | Requests list still "Waiting" after Decline | list loaded once | `useFocusEffect` reload (dev-135) | |
| — | low | "Only these one item" | copy | fixed (dev-135) | |
| — | tooling | Test Lab cut slow rack phones at 10 min (no result) | Play services model downloads | self-test timeout 15 min | A14 re-run finished |
| — | tooling | Self-test hung forever on the Pixel 8a (quality-sample upload never finished on a slow network) | no timeout on the upload | 3-min bound, warning instead (dev-137) | re-run pending |

## Results by checklist item (S8)

✅ pass with evidence · ⚠ works with a note · ✗ unsupported by hardware/stack · ⏸ needs a person/scene

| Item | Result | Evidence |
|---|---|---|
| Self-test (in-app, 32 steps) | dev-131 26/3/1/2 → **dev-136 29 pass / 1 warn / 0 fail**, no crash/ANR | test-results/dev-136/phones/SM-G950F-9-local |
| 1.3 full resolution | ✅ 4032×3024 back, 3264×2448 front | EXIF |
| 1.6 flash | ✅ ON → EXIF Flash=1 | |
| 2.1 EV + lock | ✅ after B1/B2 | request dumps |
| 2.2 volume key | ✅ photo, volume unchanged | |
| 2.3 timer | ✅ 3 s → capture 3.76 s | |
| 2.5 mirror selfie | ✅ on → EXIF orientation 4 (mirrored), off → 3 | |
| 2.6 location | ✅ after B5; shared originals GPS-free (same bytes) | |
| 3.1 video | ✅ 1080p30 + AAC in sync, live upload | ffprobe |
| 3.3 pause | ✅ self-test 2.8 s clip with 2 s left out | |
| 3.4 time-lapse | ✅ 26 s → 59 frames, 1.97 s at 30 fps | |
| 3.5 slow motion | ✗ hidden: CameraX 1.6 exposes no high-speed on the S8 (Camera2 has 720p 120/240; stock app has Super Slow-mo) | Camera info |
| 3.9 keep awake | ✅ 30 s timeout: camera on screen → still on at 75 s, off at 200 s (2-min idle release); launcher cold start → on at 50/80 s | dumpsys power |
| 3.10 shutter → gallery | ✅ instant, photo saved | |
| 3.11 live upload time-lapse | ⚠ file only grows at stop on the S8 (no head start) | |
| 4.2 live portrait | ✅ real person, 23.7 fps | |
| 4.1/4.3 portrait photo | ✅ after B4 (dev-136) | |
| 5.1 13 looks | ✅ saved recipe + preview per look; viewfinder ≈ saved (WYSIWYG) | looks sheet |
| 5.3 look suggestion | ⚠ works; "Cool" for a white ball is a debatable pick | |
| 6.1 editor | ✅ Auto + look + crop kept; 12 MP render; export 4032×2268 with EXIF; peak 577 MB | |
| 6.2 trim | ✅ recipe 2.97–6.85 s, export 3.86 s with audio | |
| 7.3 smart burst | ✅ after B6: 3 / 2 shots in 1.5 s, no camera rebuild | |
| 8.1 manual | ✅ after B3 (ISO, shutter, WB, focus) | EXIF |
| 8.2 RAW | ✅ DNG 1.4, 16-bit CFA, black 0 (pre-subtracted by Samsung) | |
| 9.1 aspect ratios | ✅ full file + removable crop | |
| 9.2 motion photos | ✅ file format (XMP + MP4 3.1 s 24 fps); Google Photos playback not checked | |
| 9.4 document scan | ✅ ML Kit scanner → page in roll + cloud | |
| 9.6 astro | ✗ longest exposure 1/10 s (self-test skip, by design) | |
| 1.8 Night (dark) / QR in camera / group blink fix / hyperlapse walk / two-phone Nearby | ⏸ need a person or scene in front of the phone | |
| Viewfinder fps | 24.9–25.5 photo (readers on/off equal), 30 video, 23.7 live portrait | SurfaceFlinger |
| Memory / heat | peak PSS 531–577 MB; battery 26 → 32 °C in a self-test; no LMK | |

## App features (S8 + live API)

| Feature | Result |
|---|---|
| Upload | photo visible in the cloud ~6 s after the shutter; offline + app killed → resumes 5 s after relaunch, MD5 identical |
| Lifecycle | HOME while recording → clip finalised and uploaded; screen off/on → viewfinder back; camera permission revoked → "Camera access needed" → Allow → camera at once |
| Gallery import | system photo picker, byte-identical upload |
| Save to Photos | full-res with edits; permission deny handled |
| Free up space | md5-checked removal, MediaStore cleaned, cloud copy intact (Android 9: immediate delete, text fixed) |
| Albums | create + add; event album QR (lens.instagrowapp.com/e/…, guests get previews only, no GPS); turning the link off → 404 at once |
| Sharing (second identity on the live API as the other phone) | push ≤ 3 s, review screen hides previews for new senders, accept → Shared tab, decline, decline + block (no more notifications), Blocked people → unblock; outgoing: real-name prompt, location off by default, recipient original GPS-free |
| Share links | `/s/` page and API fine; domain bug B10 |
| Web → app | App Link verified for lens.instagrowapp.com; link opens Lens ("This is your own link") |
| Places / People / Recaps | Places ✓ (Mohali, Hoshiārpur); People groups while charging (7/55 at the time); Recaps wait 6 h after the last photo (by design) |
| Account | signed in (email), 100 GB, devices list; sign-out/in not exercised on the phone (needs the user's inbox); API e2e 350/350 covers it |

## Stock camera comparison (same scene, ordinary indoor light)

| | Exposure | Noise (flat areas) | Brightness |
|---|---|---|---|
| Samsung camera | 1/10 s, ISO 200 | 1.85 | 77.6 |
| Lens photo | 1/25 s, ISO 500 | 4.08 (2.2×, visible at 100 %) | 72.5 |
| Lens Night | merge | 1.85 | 106.6 (~12 s capture) |

Lens's single shot is noticeably grainier than the stock camera indoors; its own
multi-frame merge already matches the stock noise. Recommendation below.

## Other device tiers (Firebase Test Lab, dev-136)

| Tier | Phone | Result |
|---|---|---|
| Old | F01L Android 8.1 | 30 pass / 1 warn / 0 fail |
| Budget | OPPO A79 Android 14 | 30 / 3 / 0 |
| Budget | Galaxy A14 5G | re-run (15 min): 28 / 3 / 1 — People "LiteRT not available" (known for this rack phone), Play services downloads timed out on the rack |
| Mid | Pixel 8a | run 1: 19 / 14 / 3 with partial connectivity; run 2 (network fine): **hung 13 min on the quality-sample upload** → self-test upload bounded to 3 min (dev-137), re-run pending. 76 % of 16 MP is the known CameraX limit |
| Flagship | Galaxy S22 Ultra | 35 / 1 / 0 |
| Screens | Robo, 2 virtual phones | 0 crashes |
| API / website | live | 350/350, pass |

## Recommendations

1. **Deploy the API** (B10) and **clean the 34 GPS previews** (B9) — both prepared, need the user's OK.
2. **Indoor quality vs stock:** an automatic short merge (2–4 frames, phone steady) for ordinary indoor light, or a longer AE floor with OIS (stock uses 1/10 s). Measure with Quality Lab sets before choosing.
3. **Slow motion on the S8 class:** a Camera2 constrained-high-speed fallback (720p 120/240) where CameraX exposes none.
4. **Promote dev-136** after the A14 / Pixel 8a re-run; dev-124 (public) still has B2–B9.
5. Hands-on items for a person: dark-room Night, QR in camera, group blink fix, hyperlapse walk, two-phone Nearby, Google Photos playing a motion photo, mirror-selfie text check.
6. Device tiers still uncovered by a real person: 32-bit-only (Galaxy A10 / TECNO via `Lens-32bit.apk` on Test Lab), Android 15/16 flagships for low-light boost, a Pixel for Ultra HDR.
