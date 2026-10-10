# Looks and editing

**Principle:** the original is never changed. A look or edit is saved as a small
**recipe** (≈1 KB JSON) next to the photo/video, locally and in the cloud.
Thumbnails and previews are re-rendered with the recipe, so every device and the
web viewer show the edited look. You can change or remove an edit at any time.

**Where:** iPhone/iPad app build (editing needs the native imaging engine, not
available in Expo Go). **Code:** `modules/lens-camera/ios/Imaging/`
(Core Image pipeline, looks, export), `src/lib/edits.ts` (recipe model),
`src/app/edit/[id].tsx` (editor), `src/lib/store.ts` (`saveEdit`, copy/paste).

## Looks

| Look | Character |
|---|---|
| Natural+ | True-to-life colour with a gentle lift |
| Vivid | Punchy colour and contrast |
| Warm / Cool | Golden or crisp blue tones |
| Golden hour | Rich sunset warmth |
| Cinematic | Teal shadows, orange highlights |
| Film | Soft film stock, lifted blacks |
| Moody | Darker, muted, dramatic |
| Fade | Low contrast, matte |
| B&W / Noir | Clean or high-contrast black and white |
| Vintage | Instant-film colours |
| Chrome | Saturated, glossy colour |

Every look has an intensity (0–100%).

## Editor

Open a photo or video → **Edit**.

- **Looks:** live thumbnail of each look on your photo, intensity dial.
- **Adjust:** Exposure, Contrast, Highlights, Shadows, Warmth, Tint, Saturation,
  Vibrance, Sharpness, Vignette, Grain. A dot marks changed sliders; RESET clears one.
- **Crop** (photos): rotate 90°, flip, straighten (±45°, auto-crops to fit),
  aspect presets (Original, Square, 4:5, 3:4, 16:9, 9:16 — centred).
- **Portrait** (photos taken in Portrait mode): background blur f/1.4…f/16 or off.
- **Auto:** one-tap enhancement (Apple's automatic analysis: exposure, shadows,
  skin tones, vibrance).
- **Press and hold** the photo to compare with the original.
- **Copy** the edit, then in the gallery select photos → **Paste edit** (looks
  and adjustments; each photo keeps its own crop).
- **Reset** returns to the original.

## Saving, syncing and exporting

- Saving updates the local thumbnail/preview immediately and uploads the new
  look as a new preview version (`thumb-vN.jpg`). Offline? It syncs later.
- Photos taken on another device can be edited too (the original is downloaded once).
- **Share / Save to Photos** produce the edited version: photos are rendered at
  full resolution (HEIC), videos are re-encoded (HEVC) with the look. The cloud
  original stays untouched.

## Video limits (current)

Video edits support looks and adjustments (not crop or portrait). The look shows
on the video's thumbnail/preview, in shared/saved exports, and **in in-app
playback on Android (dev-43+)**: the player runs the same GPU shader live on each
frame (`LensImaging.setVideoLook` → ExoPlayer `setVideoEffects`), so the file is
never re-encoded. Older APKs and iPhone still play the original. Video looks are edited on the device that recorded the video.

## Recipe format

```json
{ "v": 1, "look": "film", "intensity": 0.8, "auto": true,
  "adjust": { "exposure": 0.3, "shadows": 0.2, "grain": 0.25 },
  "crop": { "rotate": 1, "straighten": -2.5, "x": 0, "y": 0.1, "w": 1, "h": 0.8 },
  "portrait": { "aperture": 2.8 } }
```
Missing fields are neutral. Processing order: auto → portrait blur → exposure →
highlights/shadows → white balance → contrast/saturation → vibrance → look →
sharpen → vignette → grain → rotate/flip/straighten/crop.
