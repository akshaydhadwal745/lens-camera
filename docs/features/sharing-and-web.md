# Identity, sharing and web viewer

**Code:** `src/lib/identity.ts`, `src/app/share.tsx`, `src/app/settings.tsx`,
`src/app/link.tsx`; server `infra/lambda/api/identity.ts`, `shares.ts`.

## Identity (no signup)

On first open each device gets a unique random name like `quiet-tiger-8703` and a
token stored in the iOS Keychain (survives reinstalling). Settings shows your name
(tap to copy) — friends find you by it.

## Sending to friends

Select items → **Send to friends** (or Send in the viewer) → search by name or
pick from **Recent** → Send. Only items whose original has finished uploading can
be sent. Friends see them under **Shared**, with your name on each tile; edits
you make later show up for them too. Deleting an item removes it for everyone
(planned: choose "delete for everyone" or "only for me").

## Web viewer

Watch your photos/videos on any computer at the Lens web address.

1. Phone: Settings → **Link a browser** → an 8-character code appears (valid 5 minutes, once).
2. Computer: open `<web address>/link` and enter the code.

The website shows previews (so HEIC/RAW work in every browser); **Open original**
downloads the full-quality file. Sign out from the website's account page.
Planned: QR sign-in ("scan from your phone") and "Log out all computers".
