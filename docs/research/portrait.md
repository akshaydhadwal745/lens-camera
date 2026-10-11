# Portrait R&D (Android first)

Status: plan written 2026-10-11, testing not started. Goal: professional-looking
portraits on old, budget and flagship Android phones, chosen by measured
results, with the app deciding automatically. Same method as
[camera-quality.md](camera-quality.md).

## Principles (user, 2026-10-11)

- **Realistic first.** Accurate subject separation and natural blur matter more
  than the number of effects. A bad edge (blurred hair, a sharp halo, a missing
  hand) ruins a portrait faster than a weak blur does.
- **Intelligent, not more settings.** Lens finds the subject and picks the
  blur strength and look itself. Users get a **few carefully chosen styles**,
  not sliders. Strength stays adjustable later in the editor (it's an edit).
- **Works on every phone**, chosen at runtime **by capability, never by phone model**.
- **What you see is what you get.** The viewfinder shows the effect live.
- Never below original quality (Portrait captures at full resolution like Photo; original kept).
  Avoid heavy on-phone work (heat); the cloud is an option for the heavy parts.

## Where we are (measured on the Galaxy S8, 2026-10-11)

From the user's real Portrait shots in the cloud:
- The person mask (ML Kit selfie segmentation, bundled) is correct and aligned;
  the saved preview has a sharp face and a blurred background.
- **Problems found:**
  1. The viewfinder showed no blur (fixed in the build after dev-45: live mask ~6×/s on a ~320 px copy, blur from a ¼-size copy).
  2. No person → silent normal photo. Objects and pets are never detected.
  3. Weak, "ring"-looking blur (12 directions, max ~32 px on a 3264 px photo) and soft hair edges (mask is only 384 px).
  4. (Not a bug: those Portrait shots were selfies, and 3264×2448 is the S8 front camera's full 8 MP. Portrait uses the same highest-resolution capture as Photo.)
  5. One blur for the whole background: no sense of depth (near objects blur as much as far ones).

## The two problems: separation and rendering

### A. Finding the subject (mask / depth)

| # | Technique | Finds | Reach | Quality | Cost |
|---|---|---|---|---|---|
| A1 | **ML Kit selfie segmentation** (now) | people | every phone, bundled ~5 MB, offline | good body shape, soft hair, 256 px model | low |
| A2 | **ML Kit subject segmentation** | people, pets, objects, several subjects | Android 7+ with Google Play services (model downloaded by Play services) | better for non-people; edges unknown | low code; no Play services on some phones (fallback A1) |
| A3 | **MediaPipe multiclass selfie** (hair, face skin, body skin, clothes, background) | people, by part | every phone, bundled ~16 MB | hair class → better hair edges; face/skin classes enable natural retouching | medium |
| A4 | **Edge refinement** of any mask with the full-resolution photo (guided filter / matting step) | — | every phone | the biggest expected win for hair and fine edges | medium; a few hundred ms per photo |
| A5 | **Phone maker's bokeh** (CameraX `ExtensionMode.BOKEH`) | maker's own portrait (often dual-camera depth) | only phones whose maker ships it | as good as the stock camera | low code; output is baked (not an adjustable edit), availability must be measured |
| A6 | **Real depth**: Camera2 `DEPTH_OUTPUT` / dual camera, or a monocular depth model (Depth Anything / MiDaS class) | distance per pixel | depth hardware is rare; models are heavy on phones | enables depth-graded blur | high on-phone; good fit for the cloud |
| A7 | **Cloud matting** (high-quality matting + depth on upload, lazily) | any subject | every phone with a connection | best achievable | AWS cost per photo; result arrives later |

### B. Rendering the blur

| # | Technique | Look |
|---|---|---|
| B1 | Ring blur (now) | soft but "doubled" at strong settings |
| B2 | **Disc bokeh** with highlight boost (bright points become discs, like a real lens) | the "real camera" look; the main realism win |
| B3 | **Depth-graded blur** (strength grows with distance; ground plane fades in) | natural depth; needs A6/A7 or a person-height heuristic |
| B4 | **Edge-aware compositing** (no background colour bleeding into the subject, no halo) | removes the "cut-out sticker" look |

## Styles: a few, chosen carefully

**First version built 2026-10-11** (user asked to set them up now): Natural,
Studio, Mono, Stage, live in the viewfinder and adjustable in the editor
(`imaging/PortraitStyle.kt`). They still go through the rating step below;
styles that don't test well get removed or retuned.

Proposal to test (keep the 3 that test best, maybe 4):

1. **Natural** (default, automatic): disc bokeh, strength chosen from the
   subject's size in frame (close-up = stronger), gentle subject exposure.
2. **Studio**: background darkened and slightly desaturated, soft light on the face.
3. **Mono**: subject in black and white, background deeper black and white (classic portrait).
4. **Stage** (candidate): background to near black (a spotlight look). Only if it tests well.

Portrait enhancement stays subtle and automatic: face-aware exposure and white
balance (from the face/skin mask), light local contrast. **No beauty filter / face
reshaping by default.**

## Automation rules to validate

- No subject found → normal photo + a short "No person found" hint (never a silent no-op).
- Blur strength from the subject's size (and depth where available), not a fixed f-number.
- Pick the subject pipeline at runtime: A5 where the maker offers bokeh and the user hasn't
  picked a style → else A3/A1 + A4 → A2 for pets/objects where Play services exist → A7 later as "enhance in cloud".
- In Photo mode, when a face fills enough of the frame, suggest Portrait (badge), don't switch silently.

## Test plan

1. **Accuracy offline (no phones needed):** run A1/A2/A3 (+A4) on a fixed set of
   portraits with known masks (licence-checked public matting sets + our own
   shots), on the PC. Measure mask IoU and **edge accuracy** (boundary F-score,
   hair regions separately). Pick the candidates worth shipping.
2. **Speed and heat on real phones:** a hidden Portrait Lab (like the Quality Lab)
   runs each candidate on the same test images on the phone and reports time per
   preview frame and per photo, memory and battery temperature. Run on Firebase
   Test Lab: old (Android 8–9), budget (Galaxy A14, realme), mid (Pixel 8a), flagship
   (S23 Ultra), plus 32-bit phones. Real people aren't needed for timing.
3. **Real shots:** the S8 (and later other phones) shoot the same scenes with each
   style + the stock camera's portrait mode for reference: people indoors,
   outdoors, backlit, hair against a busy background, glasses, two people, a pet.
4. **Blind A/B rating** in a report page (like the quality report): which looks
   more real, edges, blur, overall. Decisions come from these ratings plus the numbers.
5. Preview cost: fps with live Portrait on vs off on each tier; the live mask
   rate drops automatically on hot or slow phones.

## Order of work

1. Ship the bug fixes: live viewfinder blur (done, needs phone test) and the
   "No person found" hint.
2. Offline accuracy study (step 1) + Portrait Lab (step 2).
3. Build the winners: edge refinement + disc bokeh first (biggest realism gain), then styles.
4. Depth (A6/A7) and pets/objects (A2) once the basics test well.
