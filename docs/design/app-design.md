# App design language

The app matches the website's "Keynote" look (black, Geist, generous type) and
mixes four of the proposed app directions (design canvas, 2026-10-10):

| Screen | Direction | What it looks like |
| --- | --- | --- |
| Camera (pro + basic) | **B · Keynote Glass** | Full-bleed viewfinder. Floating glass pills at the top (flash/tools + yellow **Night**, and **PRO**). One glass tray at the bottom: lens chips (.6 / 1× / 2), modes, an 80 px shutter (yellow ring when Night is on), library thumb, flip. |
| Library (mine, videos, shared) | **D · Endless Roll** | "The roll" large title; mono status line `2 412 FRAMES · NEVER ENDS · ALL SAFE` (or `N UPLOADING` / `N FAILED` / `N WAITING · OFFLINE`); All · Videos · Shared chips + storage chip; a film-strip edge; mono day markers (`TODAY · 10 OCT · 42 FRAMES`, today in yellow); tiles with mono frame numbers `#2412`; white **Keep shooting** pill back to the camera. |
| Photo viewer + video player | **B · Keynote Glass** | Full-bleed media. Glass back button, glass info pill (date + `12 MP · 3.1 MB`, or the upload state), green **✓ Safe** pill (tap: where it lives). Bottom glass bar: Share, big white **Edit**, Send to friends, Save, Delete. The player uses the same glass top + a glass control card with mono times. |
| Settings + sub-screens | **A · Keynote Pure** | Large title + blue Done. Account card: initials avatar, name/email, `38 GB of 100 GB`, Recent (blue) / Saver (light blue) bar, "Get +10 GB". Grouped rounded cards with white labels, grey values, chevrons. |
| Editor, sign-in, share, link, intro | shared rules | Same tokens, fonts and button styles. |

## Tokens (`src/lib/theme.ts`)

- **Colours** — `bg #000`, `surface #1C1C1E`, `surface2 #2C2C2E`, text `#F5F5F7`, muted `#A1A1A6`, dim `#86868B`.
- **Meaning, used the same way everywhere:**
  - yellow `#FACC15` = Lens doing something smart or active (Night, the selected camera mode, today, manual camera values, +GB rewards);
  - blue `#2997FF` (links) / `#0071E3` (primary buttons) = actions and storage;
  - green `#30D158` = safe in the cloud;
  - red `#FF453A` = delete, failures; `#FF3B30` = recording.
- **Fonts** — Geist (Regular/Medium/SemiBold/Bold) for all text, IBM Plex Mono for data: frame numbers, camera readouts, durations, sizes, the build label. Bundled in `assets/fonts` (OFL), loaded in `app/_layout.tsx`.
- **Shapes** — tiles 4 px (film frames), cards 20, sheets 28, glass tray 34, buttons are full pills.
- **Glass** only where controls float over a photo or the viewfinder (`glass` in theme.ts: dark 62–66 % + hairline white border). Everywhere else uses solid surfaces. There's no blur yet (expo-blur is native; add it with the next APK).
- **Buttons** — on screens: blue pill, white text. Over media: white pill, black text (Edit, Keep shooting). Selected chips: white with black text.

## How it's applied

- `src/components/ui/Text.tsx` wraps `Text`/`TextInput`. Screens keep writing `fontWeight` and it picks the matching Geist file, since Android can't synthesise weights from one custom file. A style that names its own `fontFamily` (the mono presets) is left alone. Every screen imports `Text`/`TextInput` from there, not from `react-native`.
- Older screens use `colors` from `src/lib/ui.ts`; those names now map onto the palette (`colors.link`, `colors.action` added).
- All of this is JS + font assets, so it ships by OTA to dev-41 (same runtime).

## Next native build

- Splash: black background + wordmark (the splash lives in `app.json`, so changing it changes the runtime). Until then the intro keeps the old `#0B1020` so there's no flash.
- expo-blur for real glass.
