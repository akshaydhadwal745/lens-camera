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

- Swipe between items; pinch to zoom photos (iOS); arrow keys on the web.
- Shows the preview instantly; on Wi-Fi the **full-quality original** replaces it
  automatically. On mobile data tap **HD** to load the original.
- Status line: on this device / in the cloud / uploading % / original still uploading / failed (with reason).
- Actions: **Edit** (app build), **Send**, **Share**, **Save to Photos** (or
  "Open original" on web), **Delete** (or Remove for shared items).
- Videos play the original; a video whose original hasn't arrived yet shows its poster.
