# Google Play launch

Everything needed to publish Lens on Google Play: the steps, the bundle, the store
listing text and the Data safety answers. Data answers were checked against the code
on 2026-10-15 (see "Gaps fixed before review").

## Steps

| # | Step | Who | State |
|---|---|---|---|
| 1 | Signing key backed up offline (`infra/keys/android/lens-release.jks` + password) | owner | ✅ 2026-10-15 |
| 2 | Play Console developer account ($25 once): personal (ID check, then a closed test with 12 testers for 14 days before production) or organization (D-U-N-S number) | owner | not started |
| 3 | App signing: **"Use my own key"** — upload `lens-release.jks` via Play's PEPK tool, so Play installs and website APKs carry the same certificate (SHA-256 `BD:D5:7B:…:3B`) and update each other | owner + Claude | – |
| 4 | Bundle: Actions → **Play bundle** → build = N → artifact `Lens-play-dev-N` (.aab, 64 + 32-bit, versionCode N, release key checked) | Claude | ✅ workflow |
| 5 | Store listing (below), screenshots (phone 1080×1920+, 2–8), feature graphic 1024×500, icon 512×512 | Claude drafts, owner approves | draft |
| 6 | Data safety form (below), content rating questionnaire, target audience (13+), ads: **No** | owner fills from this doc | draft |
| 7 | Privacy policy URL `https://lens.instagrowapp.com/privacy/`, account deletion URL `https://lens.instagrowapp.com/delete-account/` (check it exists) | Claude | – |
| 8 | Permissions declarations: `READ_MEDIA_IMAGES/VIDEO` (gallery clean-up: remove photos already backed up), foreground service `dataSync` (backup upload with a visible notification), location (photo location, off by default) | owner fills | draft below |
| 9 | Closed test track (personal accounts: 12 testers opted in for 14 days), then production | owner | – |
| 10 | Rotate OAuth client secrets pasted in chat (Google, OneDrive); legal operator name; lawyer check of People default-on | owner | – |

## Store listing (draft)

- **App name (30):** Lens: Camera & Cloud Photos
- **Short description (80):** A pro camera that backs up every photo and video, full quality, the moment you shoot.
- **Full description:**

  Lens is a camera and a photo library in one. Every photo and video you take is backed
  up at full quality, to Lens storage or to your own Google Drive, Dropbox, OneDrive, Box,
  S3 or WebDAV, while you keep shooting.

  CAMERA
  • Night mode, Portrait with adjustable blur, RAW and Ultra HDR photos
  • PRO controls: ISO, shutter, focus, white balance
  • Video up to 4K, slow motion, time-lapse, motion photos
  • Hold the shutter for a burst: Lens picks the sharpest shot and fixes closed eyes in group photos
  • Looks and a full editor that never touch your original

  LIBRARY
  • Your photos grouped by date, place and people (face grouping stays on your phone)
  • Share albums with a link or QR code, even with people who don't have Lens
  • Event albums: guests add their photos from their own phone
  • Recaps: short films of your trips and days
  • Free up space: remove photos from the phone once they're safely backed up

  PRIVATE BY DESIGN
  • No ads, no tracking, no selling your data
  • Delete your account and everything in it from the app

  Guest use: 5 GB free. Sign in with email or Google: 100 GB.
- **Category:** Photography. **Tags:** camera, photo backup, cloud storage.
- **Contact:** website `https://lens.instagrowapp.com/contact/` (Play also requires an email address: owner to choose).

## Data safety answers

General: **Data is encrypted in transit: Yes. Users can request deletion: Yes** (in-app
Settings → Delete account, and the website). **Shared with third parties: No** — AWS,
Google FCM / sign-in / ML Kit are service providers; storage providers the user connects
receive data at the user's direction (Play doesn't count either as sharing).

| Play data type | Collected | Optional? | Purposes | Notes |
|---|---|---|---|---|
| Personal info → Name | Yes | Optional | Account management, App functionality | Random Lens name; optional real name (Settings → Your name, shown to share partners; Google sign-in name kept only as a suggestion); affiliates' legal name |
| Personal info → Email address | Yes | Optional | Account management, App functionality | Email sign-in code, Google sign-in |
| Personal info → User IDs | Yes | Required | App functionality, Account management | Lens account id (guest), Google account id |
| Personal info → Other info | Yes | Optional | Account management | Affiliates only: PAN (encrypted, tax law) |
| Financial info → Other financial info | Yes | Optional | Account management | Affiliates only: UPI ID, payouts; kept 8 years by law |
| Location → Precise location | Yes | Optional | App functionality | Only with "Save location": in photo files and the Places feature |
| Location → Approximate location | Yes | Required | Fraud prevention, security | City from the network for sign-in prompts; IP for rate limits |
| Photos and videos → Photos, Videos | Yes | Optional (backup) | App functionality | Core feature: backup, sharing, streaming |
| Audio → Voice or sound recordings | Yes | Optional | App functionality | Only the soundtrack of videos the user records |
| App activity → Other user-generated content | Yes | Optional | App functionality | Albums, shares, edits, event albums |
| App activity → Other actions | Yes | Optional | App functionality, Fraud prevention | Invite/affiliate attribution (install referrer) |
| App info and performance → Crash logs / Diagnostics | Yes | Optional (Settings → Camera) | Analytics (app performance) | Camera events + phone model; not stored with the account |
| Device or other IDs | Yes | Required | Fraud prevention, App functionality | Hash of Android ID; push token (Firebase) |
| Contacts, Messages, Calendar, Health, Web history, Files | No | – | – | |

Face data (People) is processed **on the phone only** and is not collected (never uploaded).

## Gaps fixed before review (2026-10-15 audit)

1. Account deletion did not remove recap films (`r/`) or Quality Lab sets (`lab/sets/`).
2. Policy said location is rounded to ~100 m; the original photo files keep exact GPS (the
   database copy is rounded).
3. Policy said no third-party analytics; Google ML Kit (Play services) sends its own usage
   statistics to Google.
4. Policy didn't mention: the connected storage account label (email or host) kept on the
   server, the Firebase installation ID, Quality Lab uploads, the contact form's hashed IP.
