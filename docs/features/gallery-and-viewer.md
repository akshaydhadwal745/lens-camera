# Gallery and viewer

**Code:** `src/app/gallery.tsx`, `src/components/MediaTile.tsx`, `src/app/viewer/[id].tsx`.

## Gallery

- Tabs **Mine** and **Shared** (things friends sent you).
- Grid adapts to the screen (more columns on iPad/desktop); tiles use thumbnails,
  videos show a poster frame with a play icon and duration.
- Banner shows offline / uploading / waiting for Wi-Fi / failed (tap to retry).
- Pull to refresh.
- **Select** (or long-press) → Send to friends · Paste edit (when an edit is copied) · Delete (to Trash; see [trash-and-archive.md](trash-and-archive.md)) / Remove.

## Import from the phone gallery (Android)

The user chooses what to back up; Lens never scans or uploads the gallery on
its own.

- **Gallery → 🖼 (Import)** opens Android's photo picker (up to 100 per pick;
  older phones without it get the system file chooser for photos/videos). No
  storage permission: Lens only gets the items picked.
- Nothing is copied at pick time. Each item is **copied just before its upload**
  (exact bytes, `modules/lens-device` `copyMedia`), only if at least **500 MB
  stays free**; otherwise it waits ("Imports wait for free space") and retries
  every 10 min as other uploads free room.
- Same upload as camera shots: full original quality, MD5-checked, resumable,
  progress bar, mobile-data rules, heat pause.
- When it's verified in the cloud, **Lens deletes its copy** (`offloadReason:
  'imported'`). The original stays in the user's phone gallery and plays/opens
  from there (`localUri` = the gallery link); if it was deleted there, Lens
  uses the cloud copy.
- Picking an item that's already imported is skipped. Items taken from the
  gallery keep their date taken, so they sort into the right place.
- If an item can't be read any more before it was copied (deleted from the
  gallery), it shows as failed: "No longer in your phone gallery… Import it again".
- Share / Save / edits copy the gallery file to the cache first (`dl-…`,
  cleared by the storage guardian).
- Code: `MediaPickerContract.kt`, `LensDeviceModule` (`pickMedia`,
  `copyMedia`, `canRead`), `importFromGallery` / `copyImport` in `store.ts`,
  `importEntry` in `local-store.ts`, `src/lib/content-file.ts`.
- Not yet: GPS in imported photos may be removed by Android for apps without
  "media location" access (to verify on a real phone); iOS import.

## Viewer

- Swipe between items; **pinch, double-tap and pan to zoom** photos (Android,
  iPhone and web); arrow keys on the web.
- **Never below the original's quality.** The preview shows instantly, then
  full quality replaces it: automatically on Wi-Fi and for photos on this
  phone; on mobile data when you tap **HD** or **zoom in**. A slow connection
  only delays it; the preview stays until full quality has arrived.
- **Edited photos** show the original rendered with the edit at up to
  4096 px on the phone (never the unedited original, never just the preview).
- **Web:** JPEG/PNG originals (all Android photos) show at full quality.
  HEIC/RAW originals and edited photos show the 2048 px preview on the web
  (browsers can't decode HEIC/RAW or apply edits yet); "Open original" downloads.
- Status line: on this device / in the cloud / uploading % / original still uploading / failed (with reason).
- Actions: **Edit** (app build), **Send**, **Share**, **Save to Photos** (or
  "Open original" on web), **Delete** (or Remove for shared items).
- Videos show their poster, a big ▶ and the length. Tapping ▶ opens the
  **player page** (`src/app/player/[id].tsx`), so the player's controls never
  overlap the viewer's Edit/Send/Share bar. A video whose original hasn't
  arrived yet shows its poster with a note instead of ▶.

## Video player

Full screen, our own controls (Android, iOS, web):

- Starts playing at once: this phone's file, the cloud original, or adaptive
  streaming for long cloud videos ([video-streaming.md](video-streaming.md)).
- **Tap** shows/hides the controls; they hide by themselves after 3 s while
  playing and stay up while paused or scrubbing.
- **Double-tap** the left/right third to skip back/forward 10 s (the middle
  plays/pauses); also −10 s / ▶❚❚ / +10 s buttons.
- **Scrubber:** drag anywhere along the bar; time and length on either side.
- **Mute** and **speed** (0.5× · 1× · 1.25× · 1.5× · 2×).
- Badge with the resolution playing now (e.g. 1080p; changes with streaming).
- Rotate the phone for a landscape player.
