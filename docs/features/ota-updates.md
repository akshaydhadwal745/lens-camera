# Over-the-air updates (self-hosted)

**Promise:** most fixes reach phones in about 2 minutes, with no reinstall.
Install an APK once; after that Lens updates its own app code.

## How it works

1. Every push to `main` runs the **ota** job in "App builds" (~2 min):
   `scripts/ota-publish.mjs android` exports the JS, uploads the bundle and
   assets content-addressed to the website bucket (`ota/a/<sha256>.<ext>`,
   immutable, served by CloudFront) and writes a **signed manifest** to
   `ota/m/android/<runtime>.json`.
2. The app asks `GET <API>/v1/updates` (Expo Updates protocol v1,
   `infra/lambda/api/updates.ts`) on launch and when it comes back to the
   foreground (at most every 5 min). The API answers with the newest manifest
   for that platform + runtime version, or 204 (nothing new).
3. New code downloads in the background; a yellow **"New version ready · Tap
   to restart"** pill appears (`src/components/UpdateBanner.tsx`). Without a
   tap, it's used on the next app start. Photos, sign-in and settings stay.

## When a new APK is still needed

The **runtime version** is a fingerprint of the native code (`app.json`
`runtimeVersion.policy: fingerprint`): Kotlin/Swift, native libraries,
config plugins, permissions, icons. Change any of those and the fingerprint
changes: the update is published for the new runtime, which only new APKs
use, so an old app never runs JS that needs native code it doesn't have.
Release notes show each APK's runtime. `.fingerprintignore` keeps the
generated `android/`/`ios/` folders out of it (CI builds with them, publishes
without them; verified identical).

## Security

- Manifests are signed (RSA-SHA256) in CI with our private key: GitHub secret
  `OTA_PRIVATE_KEY`, local copy `infra/keys/ota/private-key.pem` (gitignored).
- The app embeds `certs/certificate.pem` (valid to 2046) and rejects any
  manifest not signed with the matching key. Assets are checked by SHA-256.
- Rotating the key needs a new APK (new certificate).

## Cost

A few MB per update from CloudFront plus one tiny API call per app open:
effectively ₹0. Old update files stay in `ota/a/` (the website deploy
excludes `ota/` from deletion); prune by age later if needed.

## Ads (future)

The ad SDK (AdMob) is native: one APK. After that, placements and frequency
ship as OTA updates, or live from a remote "ad settings" JSON from the API.
