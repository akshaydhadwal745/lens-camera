# Gallery and viewer

**Code:** `src/app/gallery.tsx`, `src/components/MediaTile.tsx`, `src/app/viewer/[id].tsx`.

## Gallery

- Tabs **Mine** and **Shared** (things friends sent you).
- Grid adapts to the screen (more columns on iPad/desktop); tiles use thumbnails,
  videos show a poster frame with a play icon and duration.
- Banner shows offline / uploading / waiting for Wi-Fi / failed (tap to retry).
- Pull to refresh.
- **Select** (or long-press) → Send to friends · Paste edit (when an edit is copied) · Delete (to Trash; see [trash-and-archive.md](trash-and-archive.md)) / Remove.

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
- Videos play the original; a video whose original hasn't arrived yet shows its poster.
