# Storage: Lens storage and your own

**Promise:** keep your originals where you want them, at full quality. Lens
gives everyone **100 GB free**. If you'd rather use storage you already have
(Google Drive, OneDrive, Dropbox, Box, an S3 bucket, or your own NAS), connect
it and your originals go **only** there.

**Code:** app `src/app/storage.tsx`, `src/lib/storage/` (one file per provider),
`src/lib/store.ts` (`chooseDestination`, `checkStorages`, fallback); server
`infra/lambda/api/storage.ts`, `oauth.ts`, `media.ts` (`location`).
Design: [design/own-storage.md](../design/own-storage.md).

## What users see

- **Storage pill** at the bottom of the gallery: where new shots go and how
  full it is, e.g. "Lens · 12 GB of 100 GB" or "Google Drive · 3.1 GB of 15 GB".
  A yellow dot means almost full; a red dot means it needs attention (full or
  signed out). Tap it to open **Storage**.
- **Settings → Storage** (also from the pill):
  - **New photos & videos go to:** Lens storage, or your connected storage.
  - **Lens storage:** 100 GB bar split into **Recent** (newest 20 GB, fastest)
    and **Saver** (older, stored more efficiently, still opens instantly). Plus
    a reminder that deleted items in Lens storage can be recovered for a year.
  - **Your storage:** the list of providers with **Connect**, or the connected
    one with its account, space, status, **Check now** / **Sign in again**,
    and **Disconnect**.
  - **Don't see yours?** Request a provider (we add the most requested first).

## Providers

| Provider | How you connect | Where files go | How every upload is verified | Notes |
|---|---|---|---|---|
| Google Drive | Google sign-in | "Lens" folder (Lens can only see files it created) | Drive's MD5 of the stored file | Resumable (8 MiB chunks) |
| OneDrive | Microsoft sign-in | Apps/Lens | OneDrive's QuickXorHash | Resumable |
| Dropbox | Dropbox sign-in | Apps/Lens | Dropbox content hash | Resumable (sessions last 7 days) |
| Box | Box sign-in | "Lens" folder | SHA-1 of every part and the whole file | Free Box plans: files ≤ 250 MB; bigger ones go to Lens storage |
| S3-compatible | Endpoint, bucket, keys | Your bucket/folder | MD5 on every PUT/part (rejected if altered) | Backblaze B2, Wasabi, Cloudflare R2, MinIO, AWS S3. Resumable |
| WebDAV / NAS | Folder address, user, password | That folder (created if missing) | Size, plus MD5 when the server reports checksums (Nextcloud/ownCloud) | One request per file (not resumable) |
| iCloud Drive | — | — | — | Coming later (needs the paid Apple Developer account) |

If a provider ever stores something different from what we sent, the file is
deleted there and uploaded again. Originals are never re-encoded.

**Sign-ins stay on the phone** (iOS Keychain / Android Keystore). Lens's server
only relays the sign-in (it adds the app's secret) and stores nothing.

## Rules

- **Their storage first:** when connected and healthy, originals go only there.
  Lens keeps the small thumbnail + preview so the gallery is fast and works
  offline. These don't count toward any quota.
- **Fallback:** storage full, or signed out → new originals go to Lens storage
  (within the 100 GB) and the pill/Storage screen says why. Nothing is ever
  deleted to make room.
- **Health check:** on app start, on return to the app, every 30 minutes while
  open, and on "Check now": still signed in? How much space? Reported to Lens so
  every device shows the same status. Low = under 1 GB free.
- **Viewing:** originals open straight from the provider (Google Drive, Box,
  WebDAV: with the phone's sign-in; Dropbox, OneDrive, S3: short-lived direct
  links). Share / Save to Photos / editing download the original first.
- **Free plan:** one connected storage. Several storages, photos→one /
  videos→another, and sharing originals from your own storage come with
  Lens Plus (later). Friends you share with see the **preview** of items stored
  in your own storage.

## Deleting

| Where the original is | Delete | Restore (Lens Trash, 30 days) | After 30 days |
|---|---|---|---|
| Lens storage | Lens Trash | Instant | Archive for a year (recover in ~12 h) |
| Google Drive, OneDrive, Dropbox, Box | Provider's own trash | Restores it there too | Provider empties its trash |
| S3-compatible, WebDAV | **File stays** in your storage | Instant | Lens forgets it; the file stays until you delete it yourself |

**Delete forever** removes the file from your storage too.
