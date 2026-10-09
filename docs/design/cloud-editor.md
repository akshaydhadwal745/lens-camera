# Design: Lens Studio, the premium cloud photo and video editor

Status: **proposed (2026-10-09), waiting for decisions.** Nothing is built.

Goal: a premium editor for paid users on Android, web and iPhone. Heavy work runs
on our servers so old phones can edit smoothly. Projects sync, so you can start
on the phone and finish on the web. We compete with CapCut, Canva and Adobe
Express where it matters, and win where they can't follow.

---

## 1. Audit: what we have today

| Area | Today | Gap for a premium editor |
|---|---|---|
| **Photo editing** | Non-destructive `EditRecipe` JSON: 13 looks (33³ LUTs, same on iOS and Android), 10 adjustments, crop/rotate/straighten, portrait blur, auto. Rendered **on the phone** (Android `imaging/EditRenderer`, tiles for big photos); the server stores the recipe + new thumb/preview (`edits.ts`). | No server rendering, no layers/text/stickers, no AI tools, no web editor. |
| **Video editing** | A look is baked on the recording phone only (Media3 / AVFoundation). The web and other phones can't edit video. | No timeline, no cloud render, no proxies. |
| **Cloud compute** | AWS Batch **Fargate Spot** (falls back to on-demand) running ffmpeg for HLS up to 4K/60/HDR tone-map. Idempotent, retried on Spot interruption, lazy (on first play). | CPU only, no GPU, no job progress, no queue priorities, no per-user metering. |
| **Storage** | S3 Intelligent-Tiering + versioning, CloudFront signed URLs, originals never touched, previews first, own storage (Drive/Dropbox/…). | No project storage or proxies; render outputs need a home. |
| **Sync** | Media list polling (web every 30 s + on focus); edits are versioned (`derivVersion`). | No project documents and no conflict handling. |
| **Accounts** | Email code / Google, 90-day sliding sessions, web cookie sessions, guest → account merge, account deletion. | Fine as is. |
| **Subscriptions** | **None.** No Play Billing, no web payments, no entitlements. The affiliate engine is waiting for `recordPurchase`. | **Blocker:** "paid only" needs payments first. |
| **Cost controls** | AWS Budget at $10/month with alerts, Spot, lazy processing. | No per-user quotas, no metering, no kill switch per feature. |

**Conclusion:** the foundations are reusable: non-destructive recipes, LUT looks
shared across platforms, Batch + ffmpeg workers, signed CDN and the library
already in the cloud. Missing are **payments/entitlements**, a **project
model**, **proxies**, a **render engine** and **GPU AI**.

---

## 2. Market: what competitors do and where we can win

| | CapCut | Canva | Adobe Express |
|---|---|---|---|
| Strength | Short-form video: auto captions, templates, effects, auto-edit, smart reframe, cut-out, beat sync, huge template library | Design: templates for everything, brand kits, Magic Studio (Magic Design, Magic Edit, generative video via partner models) | Firefly (commercially safe gen-AI), Clip Maker (long → short clips with captions + reframe), Enhance Speech |
| Weakness for us to exploit | **Blocked in India since 2020**; credits/AI pushed to paid tiers and desktop/web | Video editing is basic; AI video is short, generative only | Heavy, account-centric, video tools still thin |

**Recent trends to match (2026):** prompt-based first-pass editing ("make a
30-second reel from this"), auto captions in many languages with animated
styles, AI voices/TTS, background removal and auto cut-out, smart reframe to
9:16, highlight clipping from long videos, generative b-roll/fill (paid credits).

**Our unfair advantages (they can't easily copy these):**
1. **The library is already in the cloud.** Every photo and video is already
   backed up in full quality. There's no "upload your footage" step, editing
   starts instantly on any device, and templates can **fill themselves from your
   library** ("make a reel of my Goa trip": dates + places we already have).
2. **Never below the original.** Originals are untouched; exports go up to 4K/HDR,
   rendered from originals in the cloud, not from a phone-compressed copy.
3. **Camera → editor continuity.** Lens captures RAW, Ultra HDR, portrait person
   masks and pro metadata, and the editor uses them (refocus portraits, RAW
   recovery, HDR-aware exports).
4. **Works on ₹8,000 phones.** Proxy editing + cloud rendering means no heat, no
   storage needed, and the export keeps running after you close the app.
5. **India-first.** Hindi/Hinglish and regional captions with proper Devanagari
   typography, festival/wedding/event templates, WhatsApp Status and Reels
   presets, a low-bandwidth mode, UPI pricing.
6. **Shared event albums → shared reel** (planned feature): everyone's clips from
   the wedding, in one project.
7. **Privacy:** we don't train on user content (a real trust point vs CapCut).

**Don't fight on their turf:** a full Canva-style design suite (millions of
templates, fonts, stock) is a content business, not an engineering one. We do
**photo + video from your library**, with design-lite (thumbnails, stories,
collages) only.

---

## 3. Key decision: what runs where

**Challenging the assumption "run the heavy editing on our servers":** live
editing from a server (streaming the rendered picture, like cloud gaming) needs
a GPU per active user (~$0.50–1/hour) and feels laggy on Indian mobile networks.
That's too expensive and a worse experience. What works, and what pro tools do,
is **proxy editing:**

- The **cloud** makes a small, easy-to-decode copy of each clip (a "proxy":
  540p/720p, short GOP, a few hundred KB per minute), a filmstrip sprite and an
  audio waveform as soon as a clip is added.
- The **device** plays and edits proxies. Even old phones decode 720p H.264 in
  hardware without heat. Trimming, scrubbing, ordering, text and looks are
  instant.
- The **cloud** does everything heavy: final export from the **originals** (up to
  4K/HDR), all AI, full-resolution photo renders, batch edits.

| Operation | Where | Why |
|---|---|---|
| Timeline edits, trim, scrub, text, stickers, transitions preview | Device (proxies) | Must feel instant; proxies make it cheap |
| Looks + colour adjustments preview | Device (same LUTs we already ship) | Already built on iOS/Android; add WebGL on the web |
| Proxies, filmstrips, waveforms | Cloud (Fargate Spot, on import) | Once per clip, pennies |
| Final video export (1080p/4K, HDR) | Cloud | Full quality from originals; no heat; continues in the background |
| Full-resolution photo export (incl. RAW) | Cloud | Old phones can't hold 50 MP in memory |
| Captions (speech → text) | Cloud GPU (Whisper) | Accuracy, Hindi/Hinglish |
| Background removal, object eraser, upscale, video cut-out | Cloud (CPU or GPU, see §5) | Models too big for low-end phones |
| Quick person cut-out preview | Device where available (ML Kit, already used for Portrait) | Instant feedback; the cloud does the final quality |

---

## 4. Architecture

```
 Phone / Web (proxy preview, project editing)
   │  project ops (JSON)           │ uploads (already backed up)
   ▼                               ▼
 API (Lambda) ── DynamoDB: projects, revisions, jobs, usage, entitlements
   │                │
   │ enqueue        └─ S3: project snapshots, proxies, renders (CloudFront signed)
   ▼
 Job router ─► Batch Fargate Spot (CPU): proxies, ffmpeg export chunks, photo renders
            ─► Batch GPU Spot (g4dn/g6): captions, video cut-out, upscale, GPU compositor
            ─► Lambda (CPU, ≤15 min): single-photo AI (bg removal, eraser) at small sizes
   │
   └─ progress events → client (polling now; WebSocket/AppSync Events later)
```

### 4.1 Project model (sync)

- A **project** is a JSON document (inspired by OpenTimelineIO): canvas (aspect,
  fps, resolution), tracks (video, overlay, text, audio), clips that **reference
  library media by id** plus in/out points, speed, transforms, keyframes, look +
  adjustments, effects, transitions, and captions. Photo projects use the same
  model with one "frame".
- Never copy media: a project points at library items, so there's no duplicated
  storage. Imported files (music, stickers) become ordinary library items or
  project assets.
- **Sync = revisions + small operations.** The device sends a batch of operations
  with the revision it's based on. The server applies it with a conditional write
  and returns the new revision. If someone else changed the project in the
  meantime, the client re-applies its operations on top (operations address
  elements by id, so they rarely clash). Snapshots go to S3 every N revisions →
  **version history** ("restore yesterday's edit") for free.
- Offline: operations queue on the device and replay later. A shared live-cursor
  CRDT (Yjs/Automerge) is only needed for real-time collaboration on shared
  albums; it's planned for Phase 4, not now.
- "Continue where you left off": a project carries `lastOpenedOn`, the playhead and
  the selected clip; the home screen shows "Continue editing".

### 4.2 Render engine: one source of truth

The hardest problem is making **the preview match the export (WYSIWYG)**.

- **Phase 1–2: ffmpeg compiler.** The server compiles the project JSON into an
  ffmpeg filter graph. ffmpeg already covers: trims, speed, reverse, 50+
  `xfade` transitions, overlays/PiP, scale/rotate/crop, text and **animated
  captions via libass** (karaoke styles, Devanagari shaping with HarfBuzz),
  audio mix, ducking, loudness normalisation, `lut3d`. We already run ffmpeg in
  production.
- **Trick for exact colour:** every clip's look + adjustments are **baked into one
  3D LUT** by the same code that drives the preview, and ffmpeg applies it with
  `lut3d`. Preview and export colour match exactly at almost no cost.
- **Golden-frame tests in CI:** the same sample projects are rendered by the
  preview engines and the exporter, then compared (SSIM). Any mismatch fails the
  build.
- **Phase 3: GPU compositor** for keyframed transforms, masks, blend modes, 3D
  transitions, particle effects and tracked cut-outs. Candidate: **Skia
  runtime effects (SkSL)**, which run the same shader code in React Native
  (`react-native-skia`, already in the RN ecosystem), on the web (CanvasKit) and
  on servers (native Skia + NVENC). We'll run a 2-week spike to pick it before
  Phase 3.
- **Rejected:** Remotion. It's licensed per render ($0.01/render, $100/month
  minimum for companies over 3 people), uses headless Chrome (slow at 4K) and is a
  web-only preview.

### 4.3 Exports: chunked, parallel, resumable, incremental

- The timeline is split into **~10-second chunks** at cut points. Each chunk is
  one Batch array-job item rendered from the **originals**, then they're joined
  (stream copy) and audio is muxed.
- **Parallel:** a 5-minute 4K export uses 30 Spot tasks at once, so it finishes in
  about the time of one chunk.
- **Resumable:** a Spot interruption retries only that chunk; finished chunks stay in S3.
- **Incremental:** each chunk's key is a hash of its inputs. Re-exporting after
  changing one title re-renders only the chunks that changed.
- Output: a **new library item** (so it backs up, syncs, streams via HLS and
  shares like any video), the original untouched. Watermark only on
  trial/free exports.

### 4.4 Jobs and progress

- A DynamoDB job record (`JOB#`): type, project revision, chunk states, progress,
  estimated and actual cost, attempts and errors. It's idempotent by
  (project, revision, preset).
- **Queues by priority:** "interactive" (single-photo AI, <5 s target), "export
  fast lane" (paid), "background" (proxies, batch). Each queue has its own vCPU caps.
- Progress: the app polls the job (as with uploads today) and gets a
  push/email when a long export finishes. Real-time push via WebSocket comes later.

### 4.5 AI stack (licences checked for commercial use)

| Feature | Model / service | Licence | Runs on |
|---|---|---|---|
| Captions, translation, highlight detection | Whisper large-v3-turbo (faster-whisper) | MIT | GPU Spot batch |
| Photo background removal | BiRefNet | MIT | Lambda CPU (preview size) → GPU for full-res |
| Video cut-out / tap-to-select object and track | SAM 2 | Apache 2.0 | GPU Spot |
| Object eraser | LaMa | Apache 2.0 | Lambda CPU / GPU |
| Upscale / restore old photos | Real-ESRGAN | BSD | GPU |
| Voice noise removal | DeepFilterNet | MIT/Apache | CPU |
| Smart reframe (9:16), face tracking | MediaPipe | Apache 2.0 | CPU |
| Text-to-speech (Hindi + English) | Amazon Polly | pay per use | API |
| Generative fill / expand / b-roll (optional, credits) | Amazon Bedrock image/video models | pay per call | API |

**Avoid:** BRIA RMBG (non-commercial licence). Check every model's licence before shipping.

**GPU strategy (cost):** no always-on GPU at launch. Batch jobs scale to zero on
Spot. Interactive photo AI runs on Lambda (CPU) at preview size, so there's no
idle cost. A small warm GPU pool for peak hours is added only when usage pays for it.

---

## 5. Paid-only access, quotas and cost controls

**Prerequisite: payments + entitlements (Phase 0).**
- Android: **Google Play Billing** subscriptions, verified server-side, with
  real-time developer notifications (renewals, refunds) → entitlements, and also
  `recordPurchase` / `recordRefund` (affiliates are already waiting on this).
- Web: **Razorpay** subscriptions (UPI Autopay, cards). iPhone: App Store later.
- An entitlement record on the profile (`plan`, period, limits), checked **on the
  server** for every job. The app only shows it.

**Usage metering:** a ledger per user per month: export minutes (weighted:
1080p = 1×, 4K = 3×, 4K60/HDR = 4×), AI credits, active projects, project
storage. Every job reserves quota before it starts and settles it at the end
(no overruns, refunds on failure).

**Example plans** (to be decided; numbers chosen so cost stays under ~10% of
net revenue):

| | Free (today's Lens) | Lens Pro (e.g. ₹149/month) | Lens Studio (e.g. ₹349/month) |
|---|---|---|---|
| Storage | 100 GB | 500 GB | 1 TB |
| Photo editor (current) | ✅ | ✅ | ✅ |
| Premium editor (timeline, templates, captions) | Try: 3 exports/month with watermark | ✅ | ✅ |
| Export minutes / month | — | 120 (1080p) | 600, 4K/HDR |
| AI credits / month | 10 | 300 | 1,500 + generative |
| Parallel exports | 1 | 1 | 3, fast lane |

**Challenge to "paid only":** CapCut and Canva convert free users by letting
them **build** and charging to **export/remove the watermark**. I recommend:
editor open to everyone, exports and AI gated by plan. The existing simple
photo editor stays free.

**Cost guards:**
- Hard limits: timeline ≤ 30 minutes (Phase 2), 4K only on Studio, 1 running
  export per user (3 on Studio), and a per-day AI cap against bursts.
- Compute: Spot first, scale to zero, chunk caching (unchanged chunks are never
  re-rendered), proxies at low bitrate.
- Storage: proxies and filmstrips are deleted 30 days after a project was last
  opened and made again on demand; render chunks are deleted 7 days after the
  export; exports count toward the user's storage.
- Visibility: estimated cost written on every job, a monthly cost-per-user report
  in Admin, budget alarms per feature tag, and a **kill switch per feature**
  (e.g., pause generative AI if the budget is hit).

### 5.1 Rough unit costs (Mumbai; approximate, verify in the AWS calculator)

| Item | Estimate |
|---|---|
| 1080p export, Fargate Spot 4 vCPU (~2× real time) | ~₹0.05 per output minute |
| 4K export (CPU) | ~₹0.4 per output minute (GPU NVENC lower at scale) |
| Proxy + filmstrip + waveform per clip minute | ~₹0.02 |
| Captions (Whisper on g4dn Spot) | <₹0.05 per audio minute |
| Background removal (Lambda CPU) | ~₹0.05 per photo |
| Generative image (Bedrock) | ₹3–8 per image: **credits only** |

A heavy Pro user (120 export minutes + 300 AI credits) costs roughly **₹20–40/month**
against ~₹100 net from ₹149 (after GST and the Play fee). With 50% affiliate
commission on referred users, the margin is thinner, so keep generative AI on credits.

---

## 6. Security

- Workers process untrusted media: one Fargate task per job, a minimal ffmpeg
  build, input limits (duration, resolution, codecs), a read-only role scoped to
  the job's S3 prefixes, no inbound network.
- Project JSON is validated against a schema with size limits; text is escaped
  for libass; only our font list is allowed.
- Entitlements and quotas are enforced on the server on every job; job ids and
  project ids are checked against the owner.
- Shared projects (Phase 4) reuse the existing share model; exports carry no
  hidden metadata beyond what the user chose.

---

## 7. Phased plan

Estimates assume the current setup (one founder + Claude), with each phase
deployed and tested on the Android phone before the next.

| Phase | What ships | Why first | Rough time |
|---|---|---|---|
| **0. Money + plumbing** | Play Billing + Razorpay, entitlements, usage ledger, plans screen, paywall; job service (`JOB#`, priorities, progress, cost per job); affiliate wiring; render-engine spike + golden-frame test harness | Nothing premium can ship without it; also unlocks affiliates | 3–4 weeks |
| **1. Photo Pro** | Cloud full-res export (incl. RAW), layers: text, stickers, shapes; AI background removal, object eraser, upscale/restore, sky/colour match; **batch edit** (one look on 200 photos, done in the cloud); web photo editor; project sync + version history | Photos are our core; cheap compute; quick wins that prove the job + quota system | 4–5 weeks |
| **2. Video editor** | Projects with tracks; proxies/filmstrips/waveforms on import; trim, split, speed, reverse; transitions; per-clip looks (LUT bake); text + **auto captions EN/HI/Hinglish** with animated styles; music, voice-over, ducking, noise removal; aspect presets + smart reframe; chunked parallel resumable 4K export; continue on another device | The CapCut-core most users need | 7–9 weeks |
| **3. AI + templates** | Templates (Reels/Shorts/Status, festivals, weddings, birthdays) that **fill from your library**; "make a reel of my trip" auto-edit with beat sync; highlight clipper for long videos; video cut-out with tap-to-track (SAM 2); keyframes, masks, blend modes (GPU compositor); TTS voices; caption translation | Differentiators + "wow" | 8–10 weeks |
| **4. Together + generative** | Shared event-album projects (collaborate live), brand kit, design-lite (thumbnails, stories, collages), generative fill/expand/b-roll on credits, iPhone parity | After product-market fit; heavier cost | Later |

**Milestones that prove it before spending more:** after Phase 1, measure editor
usage and conversion to paid; after Phase 2, measure cost per paying user
against plan limits; adjust limits/prices before Phase 3.

---

## 8. Decisions needed

1. **Free tier:** editor open to all with watermark exports (recommended), or paid-only from the first screen?
2. **Plans and prices:** one plan (Pro) or two (Pro + Studio)? Does storage come bundled with the editor?
3. **Order:** start with Phase 0 + 1 (photos first, recommended), or jump to the video editor?
4. **Design-lite only** (recommended), or a full Canva-style design canvas?
5. **Generative AI** (Bedrock, costs per call): at launch on credits, or later?
6. **Web payments with Razorpay:** OK to set up an account (needs business KYC)?

Note: until payments exist, the affiliate program pays nothing and the editor
can't be gated.
