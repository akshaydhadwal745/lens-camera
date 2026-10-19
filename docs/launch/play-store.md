# Google Play launch

Everything needed to publish Lens on Google Play: the steps, the bundle, the store
listing text and the Data safety answers. Data answers were checked against the code
on 2026-10-15 (see "Gaps fixed before review").

## Steps

| # | Step | Who | State |
|---|---|---|---|
| 1 | Signing key backed up offline (`infra/keys/android/lens-release.jks` + password) | owner | ✅ 2026-10-15 |
| 2 | Play Console developer account ($25 once): personal (ID check, then a closed test with 12 testers for 14 days before production) or organization (D-U-N-S number) | owner | submitted 2026-10-19, waiting for Google |
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

## Readiness check (2026-10-19, build dev-137)

| Requirement | State | Evidence |
|---|---|---|
| Target API (Play: 35 since Aug 2025) | ✅ targetSdk 36, minSdk 24 | `aapt2 dump badging` dev-136 |
| 16 KB memory pages (required for new apps targeting 35+) | ✅ all 30 native libs 16 KB-aligned, `zipalign -P 16` passes | dev-136 APK |
| 64-bit | ✅ arm64-v8a (+ armeabi-v7a in the bundle) | |
| App signing key | ✅ `lens-release.jks`, same certificate as the website APKs | step 3 |
| Privacy policy URL | ✅ https://lens.instagrowapp.com/privacy/ (200) | |
| Account deletion URL | ✅ https://lens.instagrowapp.com/delete-account/ (200): in-app, web and contact-form paths | |
| In-app account deletion | ✅ Settings → Delete account (API `DELETE /account`, checked 2026-10-19) | |
| User-generated content: block | ✅ decline + block, Settings → Blocked people | S8 test 2026-10-19 |
| User-generated content: report | ✅ built 2026-10-19: Report in the viewer (shared items) and on share requests; "Report this link/album" on the web pages; terms name the rules | dev-138 |
| Advertising ID | ✅ not used (no `AD_ID` permission, no ads SDK) → declare "No ads" | manifest |
| Background location | ✅ none (fine/coarse only while the camera is open, opt-in) | |
| Store graphics | ✅ icon 512×512, feature graphic 1024×500, 5 phone screenshots 1080×2160 | `docs/launch/assets/` |
| Bundle | ⏳ `Lens-play-dev-137` (Play bundle workflow) | |

## Decision before the first upload: package name

The package name is **`com.akshay.lens`** and it can never change on Play once uploaded.
Keeping it is the low-risk choice: App Links (`assetlinks.json`), the Google sign-in Android
client, Firebase, the OTA runtime and everyone's existing install all use it, and users only
see it in the Play URL (`play.google.com/store/apps/details?id=com.akshay.lens`). Changing it
(e.g. `com.instagrowapp.lens`) means a new Firebase app, OAuth client, assetlinks entry, and
current testers reinstalling. **Recommendation: keep it.**

## Play Console answers (ready to paste)

**App access:** "All functionality is available without an account: open the app and allow the
camera. Optional sign-in is by an email code (no password) or Google. No test credentials needed."

**Ads:** No.

**Content rating (IARC questionnaire):** Category: *Utility, productivity, communication or other*
(a camera and photo app). Violence / fear / sexuality / language / drugs / gambling: **No** to all
(the app has no such content of its own). *Does the app allow users to interact or exchange
content?* **Yes** (users can send photos to people they choose, share links and event albums).
*Share location with other users?* **Yes, optional** (only when the sender turns on "Include where
they were taken"). *Digital purchases?* **No** (not yet). Expected result: Everyone / PEGI 3 /
IARC 3+ with "Users Interact" (and "Shares Location").

**Target audience:** 13+ (13–15, 16–17, 18+). Not designed for children; the terms require 18+ or
a parent's consent. *Appeals to children?* No.

**News app:** No. **COVID-19 apps:** No. **Government app:** No. **Financial features:** None
(the affiliate program and payouts are on the website only). **Health:** No.

**Data safety:** the table above.

### Permission declarations

**Photo and video permissions (READ_MEDIA_IMAGES / READ_MEDIA_VIDEO):**
> Lens is a camera and a cloud photo library: backing up and managing the user's photos is its
> core feature. Photos are added through the system photo picker. READ_MEDIA_* is used only for
> "Free up space": after a photo or video the user imported is safely backed up, Lens finds that
> exact file in the phone's gallery (checked byte for byte against the cloud copy) and asks Android
> to delete it with the system confirmation dialog. The photo picker can't do this: it gives no
> MediaStore item to delete. Lens never uploads or reads gallery items the user didn't pick.

**Foreground service (type `dataSync`, `BackupService`):**
> Uploads (backs up) the photos and videos the user just took to the user's chosen cloud storage
> while they leave the app or turn the screen off, with a visible "Backing up…" notification. It
> stops as soon as the queue is empty; on Android 15 it stops cleanly at the system's time limit
> and resumes later. User-initiated: every upload comes from a photo or video the user captured or
> imported.
> Video: record ~30 s: take a photo and a 1-minute video, press Home, show the "Backing up…"
> notification, open the roll: the item shows "Safe in the cloud". (Record on the S8 with
> `adb shell screenrecord`.)

**Location:** foreground only, opt-in ("Save location" in Settings → Camera), used to write the place
into the user's own photos and for the Places view. Not shared unless the user chooses to.

### Release notes (first release)

> Lens is a camera that backs up every photo and video at full quality the moment you shoot: Night
> and Portrait modes, PRO manual controls, RAW, 13 looks and a full editor that never touches your
> original. Share albums by link or QR code, even with people who don't have Lens.

## Closed test (personal developer accounts)

Google requires **12 testers opted in for 14 continuous days** before production access.
1. Play Console → Testing → Closed testing → create track "beta", upload `Lens-play-dev-N.aab`.
2. Testers: a Google Group (easiest: testers join the group) or an email list of 12+ Gmail addresses.
3. Share the opt-in link; testers must install from Play and keep it installed for 14 days.
4. Keep shipping builds to the track during the 14 days (shows Google an active test).
5. Apply for production with the questions about the test (what was tested, feedback, changes).
Organization accounts (D-U-N-S) skip this requirement.

## After approval

- Set the API's `PLAY_URL` (CDK context, then deploy) to the listing URL: invite links and share links
  then go to Play with an install referrer (`lens_share=`, `lens_ref=`) instead of `/download/`; point
  the website download button at Play too.
- Object Lock on the audit bucket → COMPLIANCE (see referrals follow-ups).
- Rotate the OAuth client secrets that were pasted in chat (Google, OneDrive).
