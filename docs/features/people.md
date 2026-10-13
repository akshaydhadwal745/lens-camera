# People (step 4 of docs/design/organise-and-share.md)

Your own Lens photos grouped by face, on the phone only. Design, decisions and
measured results: `docs/design/people.md`.

## For the user
- **On by default** in most countries: nothing to do; the 10 MB face model
  downloads at the first charge on Wi-Fi, then grouping starts. In the EU/UK,
  Switzerland and the US (consent laws) the **People** chip / Settings → Sharing
  → People shows one short card with **Turn on** (downloads the model now).
- **Turn off** ("Grouped on this phone, never uploaded · Turn off" at the bottom
  of People) deletes all face data and stays off.
- **Grouping runs only while charging** (and battery not low), stops if the
  phone warms up, never while the camera is open. Status line: "GROUPING WHILE
  CHARGING · 120 OF 340 PHOTOS".
- **People grid:** people in ≥ 3 photos, named ones first. Tap → their photos.
- **Person page:** Add name / Rename (private label, only on this phone), Same
  person as… (merge), Hide, long-press a photo → **Not this person** (it never
  joins that group again).
- **"Is this Riya?"**: only about people you named, when a face is close but
  not certain (0.363–0.45). Yes moves just that face; No never asks again.
- Lens account names stay random; linking a person to a Lens friend for share
  suggestions comes with step 5.

## How it works
- `modules/lens-camera/android/.../people/`:
  - `FaceScanner`: ML Kit (Play services) detect on a ≤ 1280 px copy of the
    preview; skip faces with eye distance < 24 px, yaw > 35°, pitch > 30°;
    4-point alignment (`FaceAlign`); embed.
  - `FaceEmbedder`: SFace int8 on LiteRT from Play services (~0.6 MB APK).
  - `FaceGroups`: average linkage, auto-group at cos ≥ 0.45, ask band, user
    answers always win; incremental consolidation.
  - `FaceStore`: SQLite in `noBackupFilesDir/people` (never backed up/uploaded).
  - `PeopleIndexer` + `PeopleJob` (JobScheduler: charging + battery not low,
    8-minute passes, re-check every 6 h while charging).
  - `LensPeopleModule` (`LensPeople` in JS): status, enable(url, sha256),
    disable, scanNow, groups, groupPhotos, asks, faceThumb, rename, setContact,
    hide, merge, notSame, notThis, confirm, reject, benchmark.
- JS: `src/lib/people.ts`, `src/app/people.tsx`, `src/app/person/[id].tsx`,
  `src/components/FaceThumb.tsx`; self-test step "People"
  (`src/lib/people-selftest.ts`).
- Model + self-test photos: `site/public/people/` (README has licence + credits).
- Phones without Play services: People hidden. iPhone: not yet.

## Status
- Built; not yet validated on phones. Validation plan: self-test on Test Lab
  tiers (speed, matches, phone = PC), emulator UI walk, S8 with real photos
  (kids, low light, side angles, siblings), grouping simulation on LFW without
  label noise (`research/faces/cluster.py`).
