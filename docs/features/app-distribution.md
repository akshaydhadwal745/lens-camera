# App distribution (Android, from our website)

Until Google Play, Lens is installed from **lens.instagrowapp.com/download**.

## Signing key (critical)

- Release APKs are signed with Lens's own key: `infra/keys/android/lens-release.jks`
  (PKCS12, alias `lens`, RSA 4096, valid to 2054), password in
  `infra/keys/android/keystore-password.txt`. `infra/keys/` is gitignored.
- Certificate SHA-256:
  `BD:D5:7B:A5:99:93:5D:96:03:64:56:6E:1B:CB:E9:9B:92:0F:52:56:31:72:C1:49:5D:D8:01:B3:9D:28:09:3B`
  (also in `site/public/.well-known/assetlinks.json` for app links).
- CI gets it from GitHub secrets `ANDROID_KEYSTORE_BASE64` and
  `ANDROID_KEYSTORE_PASSWORD`; `plugins/with-release-signing.js` uses it for
  release builds (local builds without `LENS_KEYSTORE` keep the debug key), and
  the "Signing certificate" CI step fails any APK not signed with it.
- **Back up the keystore + password offline** (password manager, plus a copy on
  a USB drive / Google Drive you control). If it's lost, installed apps can never
  be updated: every user would have to uninstall and reinstall. If it leaks,
  someone could ship a fake "Lens update"; rotate only with a planned migration.
- Google Play later: this key becomes the **upload key**; Play App Signing holds
  the app-signing key.
- Builds up to dev-40 were signed with the public debug key. They can't update
  to release-signed builds: uninstall first (cloud photos are safe).

## Hosting

- CI release job uploads each build's APKs to the website bucket:
  `downloads/android/builds/<N>/Lens.apk`, `Lens-32bit.apk` and `release.json`
  (`{build, commit, runtime, publishedAt, files: {arm64-v8a|armeabi-v7a: {url, size, sha256}}}`),
  served by CloudFront at `https://lens.instagrowapp.com/downloads/…`.
- The website deploy's `s3 sync --delete` excludes `downloads/*` (and `ota/*`).
- **Promote** a build to the public download only after it passes everything:
  `scripts/promote-release.sh <N>` runs `verify-release.sh`, downloads each APK
  from the download host, checks its SHA-256 and that it's signed with the Lens
  release key, then copies its `release.json` to `downloads/android/latest.json`
  (+ CloudFront invalidation).

## Download page

`site/src/components/Download.astro` (EN + HI at /download and /hi/download)
reads `latest.json` in the browser: main button = 64-bit APK, link for the
32-bit APK, version + size + SHA-256, install steps (unknown apps, Play Protect),
and what to do when replacing a test build.

## Updates inside the app

- JS-only changes: over-the-air (docs/features/ota-updates.md), automatic.
- Native changes (new runtime): `src/lib/app-update.ts` reads `latest.json` on
  launch and when the app returns (at most every 6 h). If the promoted build is
  newer than the installed one (Android versionCode = CI run number) and its
  runtime differs from the running one, the banner shows
  **"New Lens version · Download (size)"**, opening the APK for this phone's CPU
  (`supportedAbis()` from lens-device).

## Permissions removed (`app.json` → `android.blockedPermissions`)

Added by libraries but unused, and flagged by Play Protect / Play review:
draw over apps (SYSTEM_ALERT_WINDOW), physical activity (ACTIVITY_RECOGNITION),
read all photos / videos / audio (READ_MEDIA_*, READ_MEDIA_VISUAL_USER_SELECTED;
Lens uses the photo picker, and "save to gallery" is write-only),
biometric/fingerprint.
