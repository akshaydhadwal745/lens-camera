# Development

## Setup (Linux, no Mac needed)

```bash
source ~/.nvm/nvm.sh        # Node 24
cd ~/camera-app && npm install
cd infra && npm install
```
`.env` (not committed) holds `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WEB_URL`
(from `infra/outputs.json` after a deploy).

## Run on a phone

- **Expo Go (basic camera, no native modules):** `npm run tunnel` → scan the QR
  code. Uses a Cloudflare quick tunnel so it works on any network. Press `r` to reload.
- **Lens app build (pro camera, editing):** install `Lens-dev.ipa` from the
  GitHub release with SideStore (one-time USB setup with iloader), or
  `Lens-dev.apk` on Android. Then `npm run tunnel` and open the app — JS loads
  live from your computer; only native changes need a new build.

## Builds (GitHub Actions, `.github/workflows/ios-build.yml`)

Triggered by changes to `modules/**`, `app.json`, `package*.json`:
- **iOS:** unsigned Debug .ipa on macOS (ccache + CocoaPods cache, ~10 min).
  Fails loudly on any compiler error and verifies the app binary exists.
- **Android:** debug .apk (arm64) on Linux (~12 min).
- Both are published to a `dev-N` release.

## Checks before shipping

```bash
npx tsc --noEmit                         # app
(cd infra && npx tsc --noEmit)           # backend
npx expo export --platform ios|android|web
npx expo-doctor
infra/scripts/e2e.sh                      # live API end-to-end (~50 checks)
```

## Deploy backend + web viewer

```bash
cd infra && npx cdk deploy --profile lens --require-approval never --outputs-file outputs.json
# or from the root: npm run deploy  (builds the web viewer too)
```
AWS access is keyless (IAM Roles Anywhere, profile `lens`) — see `infra/README.md`.

## Project layout

```
src/app/            screens (Expo Router)       src/lib/        state, upload, edits, API
src/components/     UI (pro camera, tiles…)     modules/lens-camera/  native iOS camera + imaging
infra/              CDK stack, Lambda API, scripts   docs/          this documentation
```
