# Notifications (Android)

Lens notifies about four things, nothing else (no marketing):

| Notification | When | How |
|---|---|---|
| "quiet-tiger wants to share 12 photos" / "… shared 12 photos with you" | a share request arrives (or is auto-accepted from a trusted sender) | push |
| "quiet-tiger accepted your 12 photos" | your share was accepted | push |
| "+10 GB: a friend joined Lens" | an invite is rewarded | push |
| "Lens storage is 90% full" | the upload that crosses 90 % of the quota | push |
| "All 340 items are safe in the cloud" | a background backup of 10+ items finishes while Lens is closed | on the phone (no server) |

**Settings → Notifications**: one switch each (Shares, Invites, Storage: stored
on the server per account, `GET/PUT /notifications`; Backup finished: on the
phone). The Android permission is asked at a moment it helps (after sending a
share, opening Sharing, switching one on), not at launch.

## How it works

- **Firebase Cloud Messaging, sent straight from our API** (`infra/lambda/api/push.ts`,
  HTTP v1): no third-party push service, no cost. The Firebase service-account
  key is in SSM `/lens/fcm/service-account` (project `lens-5df67`, account
  `lens-fcm-sender`, role Firebase Cloud Messaging Admin). Without the key
  `notify()` does nothing.
- **Tokens:** the app registers this phone's FCM token for the signed-in identity
  (`PUT /push`; again after sign-in or when the token rotates; `DELETE /push` on
  sign-out). Stored as `D#<id> PUSH#<hash>`; at most 10 per account; a token FCM
  reports as unregistered is deleted.
- **App:** `src/lib/push.ts` (token, tap → `router.push(data.route)`),
  `src/lib/local-notify.ts` (channels shares / invites / storage / backup, the
  local backup notification). `expo-notifications`; `google-services.json` is
  not in the repo: CI writes it from the `GOOGLE_SERVICES_JSON` secret before
  prebuild (locally: keep the file in the project root, gitignored).
- **Failure never blocks the action**: `notify()` swallows errors.
- iPhone: needs an Apple developer account (APNs); not built.
