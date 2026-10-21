# Dual camera (front + back) — PARKED by the owner 2026-10-21 ("make it later")

Owner's requirement: **every phone** can make dual photos and videos (front + back in one file).

## How every phone gets it
| | Phones with concurrent cameras (Android 11+, `FEATURE_CAMERA_CONCURRENT`) | Other phones (Galaxy S8, budget, Android 8–10) |
|---|---|---|
| Dual photo | CameraX ConcurrentCamera: both at the same instant | Back photo, then front photo ~1 s later (BeReal method) |
| Dual video | Both record live (CameraX concurrent + composition) | **2-step**: record the scene with the back camera, then Lens plays it back and records the person's reaction with the front camera; composed in sync |
| Output | One photo/video, face in a draggable corner bubble or split screen | Same output |

One DUAL mode button everywhere; the method is chosen automatically (probe in FeatureProbe +
self-test step; Test Lab shows reach). Keep both originals so the layout stays editable
(non-destructive, like looks).

## Plan (~4 days)
1. Dual photo, every phone (~1 day; S8 testable).
2. Dual video 2-step, every phone (~1.5 days; S8 testable).
3. Dual video live, concurrent phones (~1.5 days; Test Lab phones).
4. Layouts: corner bubble (drag) + split; editable later.

Facts: the S8 reports no concurrent-camera feature (checked 2026-10-21).
