# Lens documentation

Lens is a cloud-first camera app: shoot without worrying about phone storage —
every photo and video goes to the cloud at original quality, and the phone keeps
only what it needs. iPhone/iPad app (Expo / React Native + a native iOS camera
module), Android app (basic camera for now), and a web viewer.

## Feature guides

| Area | Guide |
|---|---|
| Pro camera (manual controls, lenses, monitoring, presets) | [features/camera.md](features/camera.md) |
| Capture modes (Night, Portrait, live looks, HDR / fps / stabilization video) | [features/capture-modes.md](features/capture-modes.md) |
| Looks & editing (non-destructive) | [features/looks-and-editing.md](features/looks-and-editing.md) |
| Cloud upload, previews & storage | [features/cloud-and-storage.md](features/cloud-and-storage.md) |
| Gallery & viewer | [features/gallery-and-viewer.md](features/gallery-and-viewer.md) |
| Identity, sharing & web viewer | [features/sharing-and-web.md](features/sharing-and-web.md) |

## Engineering

| Topic | Doc |
|---|---|
| System architecture, data model, API, costs | [architecture.md](architecture.md) |
| Setup, running on devices, builds, deploys, tests | [development.md](development.md) |
| What's next | [roadmap.md](roadmap.md) |

## Feature status

"Device-tested" means it has been run on a real phone. Everything marked
"No" compiles and passes automated checks but still needs a real-device test.

| Feature | Platform | Built | Device-tested | Notes |
|---|---|---|---|---|
| Basic camera (photo/video, flash, zoom, grid, timer) | iOS, Android | ✅ | Partly (Expo Go) | Used in Expo Go and on Android |
| Pro camera: manual ISO/shutter/WB/focus/EV | iOS | ✅ | No | Needs the SideStore build |
| Lens switching (.5× / 1× / tele) | iOS | ✅ | No | Uses the lenses the phone has |
| RAW / ProRAW (DNG) | iOS | ✅ | No | ProRAW on Pro iPhones only |
| HEIC capture (default) | iOS | ✅ | No | JPEG fallback |
| Histogram, zebras, focus peaking, false color, level, grids, crop guides | iOS | ✅ | No | |
| Presets (built-in + custom) | iOS | ✅ | No | |
| Live looks in the viewfinder | iOS | ✅ | No | Falls back to plain preview if frames unavailable |
| Night mode (multi-frame merge) | iOS | ✅ | No | Hold still ~1 s |
| Portrait mode (adjustable blur after capture) | iOS | ✅ | No | Needs a dual/TrueDepth camera |
| HDR video, 24/30/60 fps, stabilization modes | iOS | ✅ | No | Depends on the phone's formats |
| Apple Log video | iOS | ✅ | No | iPhone 15 Pro and newer |
| Looks (13) + intensity | iOS | ✅ | No | Non-destructive by default |
| "Save looks into the file" (bake) | iOS | ✅ | No | Videos are re-encoded after recording |
| Editor: adjustments, crop/rotate/flip/straighten, portrait blur, auto-enhance | iOS | ✅ | No | |
| Copy / paste edits | iOS | ✅ | No | |
| Verified cloud upload (MD5 per part, resumable, up to 1 TB) | iOS, Android | ✅ | Partly | Server side fully tested (e2e) |
| Mobile-data policy (everything / ≤100 MB / Wi-Fi only) | iOS, Android | ✅ | No | |
| Thumbnails + previews uploaded first | iOS, Android | ✅ | No | Web verified in Chrome |
| Local copy retention + free up space | iOS, Android | ✅ | No | |
| Gallery (Mine / Shared), viewer, HD button | All | ✅ | Partly | |
| Share with friends by name | All | ✅ | No | Server side tested |
| Web viewer (link with code) | Web | ✅ | ✅ (headless Chrome) | QR sign-in planned |
