# People: on-device face grouping (step 4 of organise-and-share.md)

Status: **design approved 2026-10-13** (decisions below). Building in the order at the end.

## Goal
"Show me every photo of Riya" and "share the trip photos Riya is in with
Riya", without any face data leaving the phone.

## Rules (already agreed 2026-10-12)
- Opt-in, **off by default**; explicit consent screen (faces are biometric data).
- Face data never leaves the phone: no upload, no server copy, not in Android
  cloud backup.
- Group only while **charging**, on the previews already on the phone (no heat
  while shooting or in the pocket).
- The user names a group and can link it to a Lens contact. A share
  suggestion appears only if that contact turned on "Let friends' Lens suggest
  me". It always goes through the confirm sheet, and the recipient still accepts.
- "Delete all face data" button; switching People off deletes everything.

## Model choice (researched 2026-10-13)

| Option | Licence | Size | Verdict |
|---|---|---|---|
| **OpenCV Zoo SFace** (MobileFaceNet trained with SFace loss, 128-d, 112×112 aligned input) | **Apache 2.0** (commercial OK) | int8 9.9 MB, fp32 38.7 MB (ONNX) | **Recommended** |
| InsightFace ArcFace / buffalo_s (w600k_mbf) | code MIT, **weights non-commercial only** | ~13 MB | ✗ not allowed in a commercial app without a paid licence |
| Other MobileFaceNet / GhostFaceNet / EdgeFace weights | mostly MS1M-trained → research-only data | 1–5 MB | ✗ licence risk |
| Cloud (AWS Rekognition) | paid per image | n/a | ✗ biometric data in the cloud; against the agreed rule; ~$1 / 1,000 images |
| Commercial SDKs | paid | varies | only if SFace fails quality tests |

SFace accuracy (OpenCV's evaluation): 99.40 % fp32, 99.32 % int8. Same-person
cosine threshold in OpenCV's FaceRecognizerSF is 0.363. We tune ours on real
photos and set it stricter for automatic merging.

**Detection + alignment:** ML Kit face detection is already in the app (Play
services, unbundled). Its 5 landmarks (both eyes, nose base, mouth corners)
give the same 5-point alignment SFace was trained with. YuNet is not needed.

**Runtime:**
- **A (recommended):** convert SFace ONNX to TFLite (int8/fp16) and run it on
  LiteRT from Google Play services. Adds roughly nothing to the APK.
- **B (fallback):** ONNX Runtime Mobile running the original ONNX file. No
  conversion risk, but adds a few MB per ABI.

Pick B only if A's embeddings drift from the ONNX originals (gate: cosine ≥ 0.99
on the same aligned faces).

**Delivery:** the model downloads once when the user turns People on (~10 MB,
from our CloudFront, SHA-256 checked). It is not inside the APK. Cost is about
$0.001 per user who opts in.

## How it runs
1. **Settings → People → Turn on** opens a consent screen: what it does, that
   it stays on this phone, that it also groups other people in your photos, and
   how to delete it. Then the model downloads.
2. **Background job** (WorkManager, constraints: charging + battery not low):
   - for each own photo not yet scanned: ML Kit detect on its 1024 px preview;
   - skip faces < 64 px or turned away (euler angles > 35°) or blurry;
   - align to 112×112 and embed (128 floats);
   - stop at thermal "warm"; resume next charge.
   - Old phones just take more nights. Nothing runs while the camera is open.
3. **Store:** a small SQLite database in `noBackupFilesDir` (excluded from
   Android backup and never uploaded). It holds photo id, face box, embedding,
   cluster id and a tiny face crop for the People grid.
4. **Grouping:** a new face joins the nearest group when cosine ≥ the strict
   threshold. Otherwise it starts a new group. While charging, groups are
   re-clustered (average linkage), and the user's merges and "Not this person"
   corrections always win. Only groups with ≥ 3 photos are shown.

## Screens
- Roll chip **People** (next to Places): grid of faces with photo counts.
- Person page: their photos; **Name** ("Riya"), **Link to a Lens contact**,
  **Merge with…**, **Not this person** on a photo, **Hide**.
- Suggestions: after a shoot, the roll strip says "8 new photos with Riya ·
  Share?". This only appears if Riya is linked AND has "Let friends' Lens
  suggest me" on. Tapping it opens the usual confirm sheet → share request.
- Settings → People: on/off, "Scanning: 1,240 of 3,100 photos (while
  charging)", **Delete all face data**.

## Names (user question 2026-10-13: "Lens only gives random names")
- **A group's name is a private label the user types** ("Mom", "Riya"), stored
  only in the on-phone face database, like a phone contact name. Unnamed groups
  just show the face.
- **Lens account names stay random** (`quiet-tiger-8703`) and matter only for
  sharing: "Link to a Lens friend" picks from people you already shared with,
  scanned ("My Lens code") or saw nearby, so nobody types a random name. The
  list shows "Riya · quiet-tiger-8703".
- **Smart link (on the phone, from your own share history):** when a face group
  appears in most photos you shared with one friend, ask once: "Is this
  quiet-tiger-8703? Link to suggest shares." Never linked without a yes.

## Server (no face data)
- `PUT /me` gains `suggestMe: boolean` (default off), set in Settings →
  Sharing "Let friends' Lens suggest me".
- Contacts / recent people responses include `suggestMe` so the phone knows
  whom it may suggest.
- e2e: flag default off, set/unset, visible only to people you've shared with
  and never across a block.

## Legal / store
- Privacy policy (EN + HI): a People row ("processed only on your phone; never
  sent to us; delete any time").
- Play Data Safety: on-device-only processing isn't "collected". Declare the
  `suggestMe` flag only.
- US biometric laws (Illinois BIPA, Texas, Washington): consent screen + on
  device + delete. **Get a lawyer's read before US marketing** (Google Photos
  face grouping was the subject of BIPA suits).
- Phones without Play services: People is hidden (same as the document scanner).

## Spike results (2026-10-13, research/faces/)
- **Alignment:** our Umeyama 5-point maths = OpenCV `alignCrop` exactly (pixel
  diff 0, embedding cosine 1.0000). Kotlin `FaceAlign` matches numpy to 2e-5
  (`FaceAlignTest`, 5/5).
- **Thresholds, LFW 6000 pairs (3000 same / 3000 different):**

  | cosine ≥ | same person found | wrong person merged |
  |---|---|---|
  | 0.363 (OpenCV default) | 98.0 % | 0.10 % (3/3000) |
  | 0.40 | 97.0 % | 0.03 % |
  | **0.45 = auto-group** | **95.3 %** | **0 / 3000** |

  Between 0.363 and 0.45 the app asks ("Is this Riya?") instead of grouping.
  **Phone setup (int8 + 4-point alignment, eyes + mouth corners):** 94.9 %
  found, still 0 / 3000 wrong at 0.45. Used because ML Kit's nose point is the
  nose base, not the template's nose tip.
- **Grouping (research/faces/cluster.py, same algorithm as FaceGroups.kt;
  parity test FaceGroupsParityTest = identical groups on 209 real faces):**

  | Library | Rule | Wrong faces | In shown groups | Split people |
  |---|---|---|---|---|
  | Phone-like: 40 regulars + 300 strangers | 0.45 | 0.15–0.46 % | 0 | 7.5 % |
  | Phone-like | **0.45 + one-face groups 0.55** | **0** | **0** | 7.5 % |
  | Clean LFW, 6,391 faces of thousands of people | 0.45 | 1.97 % | 54 | 5.6 % |
  | Clean LFW | **0.45 + one-face groups 0.55** | **0.31 %** | 14 | 13.7 % |

  Many raw-LFW "errors" were LFW's own label noise (same person under two
  names, two-person photos, twins). Chosen: **join/merge with a one-face group
  only at ≥ 0.55** (a single photo is a noisy reference); a split person is one
  tap to fix ("Same person as…"), a wrong face is the harmful error. Questions
  only about people the user named (raw sim: thousands of asks otherwise).
- **Real phones, Test Lab dev-82 self-test (People step):** Pixel 8a 17 ms/face
  + 0.6 s detect/photo ✓; Motorola edge 50 25 ms + 1.1 s ✓; F01L (Android 8.1,
  old) 359 ms + 4 s (slow but fine while charging, ~70 min per 1,000 photos) ✓
  matches right everywhere; Galaxy A14: Play services LiteRT not on the phone and
  Test Lab blocks Play module downloads ("Download of container feature
  tflite_dynamite is disabled") → **enable() now gets the engine first (up to
  2 min) and explains if it can't**; OPPO: Test Lab network timeout.
- **Real phones, AWS Device Farm dev-85 (normal Play services):** Galaxy S9
  (Android 9, S8 class) ✓ matches right, **48 ms/face, 1.2 s detect/photo**;
  Galaxy A14 5G ✓ 38 ms/face, 1.4 s/photo (the A14 that failed on Test Lab:
  there Play services may not download modules). ~20–25 min of charging per
  1,000 photos on an S9-class phone. Emulator (google_apis image, no Play
  Store) can't download the engine either: full UI walk on a Play Store image.
- **TFLite conversion (onnx2tf):** fp32 and fp16 = ONNX (cosine 1.00000, 500
  faces). **Shipped: dynamic-range int8, 9.9 MB** (cosine ≥ 0.997 vs ONNX; LFW
  accuracy identical: 95.3 % / 0 wrong at 0.45).
- **Test photos** (public domain, site/public/people/test): same person 0.70,
  different people 0.10, family photo 4 faces and Obama found at 0.82: all
  models and both 4/5-point alignments pass. The phone self-test repeats this.
- **APK cost, measured:** the LiteRT Play services client brings a 0.58 MB
  connector library (arm64; 0.36 MB on 32-bit), so **~0.6 MB**, not 0
  (full ONNX Runtime would be 34 MB).
- **Hosting:** `https://lens.instagrowapp.com/people/sface-v1.tflite` (deployed
  with the website; SHA-256 `37cf4c81…52e3`), licence + credits in
  `site/public/people/README.txt`.

## Build order (one feature at a time)
1. **Spike, on the PC (light, `nice`):** run SFace in Python onnxruntime with
   the same 5-point alignment the phone will use; pick the thresholds on a
   small labelled set. Gate: same-person / different-person split clean.
2. **Native:** `lens-device` FaceIndex (detect → align → embed) + a self-test
   benchmark step. Test Lab: budget, 32-bit, S8-class, flagship (ms per face,
   temperature). Gate: < 150 ms/face on budget phones while charging.
3. Background job + SQLite store + clustering (Kotlin unit tests).
4. UI: consent, People chip/grid/person page, name/merge/split, delete all.
5. API `suggestMe` + suggestions strip + e2e.
6. Docs (features/people.md), privacy policy, checklist rows, Data Safety notes.

iPhone later: same model via Core ML, Apple Vision for detection.

## Decisions (user, 2026-10-13)
1. **Runtime: LiteRT from Google Play services (+0 MB APK)** with SFace
   converted to TFLite; the model downloads only when People is turned on.
   (The user first picked full ONNX Runtime, then switched on learning it adds
   ~34 MB to every APK: "our app should feel not heavy". Fallback if the
   converted model drifts from the ONNX original (cosine < 0.99): slim ONNX
   Runtime build, ~2–4 MB.) The bar is "without any issues".
2. **Photos: only your own Lens photos** (not received shares, not imports).
3. **Availability: everywhere.** Updated 2026-10-13 (user: "should be easy and on by
   default"): **on by default** (like Apple Photos / Samsung Gallery) except where the
   law asks for consent first: EU/EEA, UK, Switzerland and the **US** (Illinois BIPA,
   Texas, Washington; Apple was sued under BIPA for on-device default face grouping,
   Hazlitt v. Apple). Country = SIM, then network, then phone language (no location);
   unknown = ask. There one tap turns it on (short card, no long screen). On by
   default = a marker only; the charging job downloads the 10 MB model **on Wi-Fi**.
   "Turn off" deletes everything and is remembered (never auto-on again).
   Lawyer check before launch marketing (launch list).
