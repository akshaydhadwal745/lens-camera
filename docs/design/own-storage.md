# Design: Connect your own storage (+ Lens storage tiers)

Status: **proposed, waiting for approval**, so no code yet. Decisions were agreed
with the founder on 2026-10-08.

## 1. What we're building

- A user can **connect their own storage**: Google Drive, Dropbox, OneDrive,
  Box, S3-compatible (Backblaze B2, Wasabi, Cloudflare R2, MinIO…), or WebDAV
  (Nextcloud, ownCloud, Synology/QNAP). iCloud Drive comes later because it needs
  the paid Apple Developer account. Users can also **request** a provider we don't support.
- **Their storage comes first.** When connected, originals go **only** there.
  Lens storage is used when nothing is connected, or as a fallback.
- **Previews always stay on Lens** (thumbnail ~40 KB + preview ~0.5 MB per item).
  The gallery stays fast, works offline, and the web viewer works. Previews
  don't count toward any quota.
- **Lens storage: 100 GB free for everyone**, shown as **Recent 20 GB + Saver
  80 GB**. Everything opens instantly; Saver is just cheaper for us. Paid plans
  later sell more storage and features, not speed.

## 2. Free vs paid

| | Free | Paid (later) |
|---|---|---|
| Lens storage | 100 GB (Recent 20 + Saver 80), automatic | More storage; pin items to Recent |
| Own storage | **One** provider, everything goes there | Several; photos to one, videos to another |
| Fallback when own storage is full or disconnected | Lens storage (within 100 GB) | Same |
| Gallery, previews, offline | ✅ | ✅ |
| Share items stored in Lens | ✅ | ✅ |
| Share items stored in own storage | Preview only | Original: Lens keeps a copy (counts toward Lens storage, removed 30 days after the last share ends) |
| Web viewer | Previews (originals only for Lens-stored items) | Previews + originals |
| Move old Lens items to own storage | ❌ | ✅ |
| Storage sign-in kept on our server | ❌ (only on the phone) | ✅ (encrypted; needed for sharing and the web) |

## 3. User experience

- **Storage indicator** in the gallery's bottom bar: the provider icon (Lens,
  Drive, Dropbox…), plus an orange dot when space is low and a red dot when
  something needs attention. Tapping it opens **Settings → Storage**.
- **Settings → Storage**
  - **Lens storage** card: a 100 GB bar ("Recent" and "Saver" explained in one
    plain sentence), with how many items and how much space.
  - **Your storage** card: connected provider, account, space used/free, status
    (OK / almost full / full / sign in again), **Disconnect**.
  - **Connect a storage**: provider list → that provider's sign-in page → back
    in Lens, connected. For S3/WebDAV, a short form (address, bucket/folder,
    keys/password) with a **Test** button.
  - **Request a provider**: name + optional note.
  - (Paid) **Where things go**: Photos → [provider], Videos → [provider].
- **Warnings:** a banner when their storage is full, almost full (<1 GB), or
  signed out. Opening an item whose original can't be reached shows the preview
  with "Original is in your Google Drive, sign in again to open it".
- **Deleting an item stored in their storage:** the file goes to **that
  provider's own trash** (they all keep deleted files ~30 days), and Lens's Trash
  shows it with Restore. The deleted-items archive (Deep Archive, 1 year) only
  applies to items stored in Lens, because we don't hold the bytes for theirs.

## 4. Architecture

```
Phone ── previews ───────────────► Lens (S3, as today)
  │ ── metadata (where, verified) ► Lens API (DynamoDB)
  └── original ─────────────────► the user's storage (direct, resumable, verified)
                                   (or Lens S3 when no storage / fallback)
```

### Connectors (on the phone)
One interface, one module per provider:
`connect()`, `refresh()`, `quota()`, `upload(file, onProgress)` (resumable +
verify), `openUrl(item)` (for viewing), `trash(item)`, `restore(item)`.

| Provider | Sign-in | Access limited to | Resumable upload | How we verify bytes | File limit |
|---|---|---|---|---|---|
| Google Drive | OAuth (PKCE), scope `drive.file` | Files Lens created | Resumable session, 256 KiB-multiple chunks | **MD5** (already computed natively) | 5 TB |
| Dropbox | OAuth (PKCE), App folder | `/Apps/Lens` | Upload session, ≤150 MB chunks | `content_hash` (SHA-256 of 4 MB blocks), native SHA-256 | 350 GB |
| OneDrive | Microsoft OAuth (PKCE), `Files.ReadWrite.AppFolder` | `/Apps/Lens` | Upload session, 320 KiB-multiple chunks ≤60 MiB | `quickXorHash` (needs our own implementation, see risks) | 250 GB |
| Box | OAuth (needs our server to swap the code, because Box requires a client secret) | Lens folder | Chunked upload (≥20 MB) | SHA-1 per part + whole file | **250 MB on free Box plans** |
| S3-compatible | Access key + secret (stored on the phone, encrypted) | The bucket/prefix they give | Multipart, same code as Lens | **MD5 per part** (as today) | 5 TB |
| WebDAV | User + app password | The folder they give | Nextcloud chunked upload; other servers single PUT | Nextcloud checksum header; otherwise size + read-back for small files | Server-dependent |

### Server changes (small)
- `Storage` record per identity: `D#{id}` / `ST#{storageId}`: provider, label,
  account, status, used/free bytes, lastCheckedAt (no tokens for free users).
- Media record gets `location`: `lens` or `{storageId, provider, ref}`. Lens
  quota counts only Lens-stored originals.
- `Request` record for "request a provider" (shown to us in a simple list).
- Box only: a token-exchange endpoint (keeps Box's client secret on the server).

### Health checks
- **Free (sign-in only on the phone):** the phone checks its storage on app
  open, before uploads, and every 30 minutes while open: still signed in? How
  much space? It reports the status to the server so the web and other devices
  can show it.
- **Paid (sign-in on the server):** a scheduled job puts storage checks on a
  queue (EventBridge → SQS → Lambda) so they're spread out. The same queue
  later handles copy-for-sharing jobs.

### Fallback rules
Own storage full, signed out or unreachable → new originals go to **Lens storage**
(if there's room in the 100 GB), with a banner telling them why. If Lens storage
is also full, items wait safely on the phone. Nothing is ever deleted to make room.

### Storage guardian and Trash
- The guardian only removes a phone copy once the original is **verified** in
  its storage (Lens or theirs), same rule as today.
- Trash for own-storage items: provider trash + Lens Trash entry (preview) for
  30 days; Restore un-trashes it at the provider.

## 5. Lens storage tiers (Recent + Saver)

Implementation: **S3 Intelligent-Tiering, unchanged**. Originals not opened for
30 days move to a cheaper tier automatically, and after 90 days to an even
cheaper one, still opening in milliseconds with no retrieval fee.

| | Shown to users | Real mechanism | Our cost/GB-month |
|---|---|---|---|
| Recent | "Newest 20 GB, fastest" | Frequent tier | ~$0.025 |
| Saver | "Older items, stored more cheaply, still instant" | Infrequent → Archive Instant tiers | ~$0.014 → ~$0.005 |

Cost of a user who fills all 100 GB: **~$0.60–1.00/month (₹50–85)**. A
"slower Saver" was considered and rejected: it saves almost nothing (~$0.0045 vs
~$0.005) and makes the experience worse.

The split shown in the app is by date (newest 20 GB = Recent), so it's simple
and predictable. Later, S3 Inventory (daily report, ~$0.0025 per million
objects) can show the real tier split if we want.

## 6. Build order (each step tested before the next)

1. **Storage settings + indicator, Lens only**: Recent/Saver explanation,
   server `Storage`/`location` model, request-a-provider form. *(Testable in Expo Go.)*
2. **Connector framework + Google Drive**: sign-in, resumable upload with MD5
   verification, view the original, trash/restore, health checks, fallback.
3. **Dropbox**, then **OneDrive**.
4. **S3-compatible** and **WebDAV**.
5. **Box** (with the server token exchange).
6. Docs, e2e tests, device testing.

Later: paid features (several storages, sharing copies, web originals,
migration, pinning, more storage), iCloud Drive.

## 7. What the founder needs to set up

| What | Why | Cost |
|---|---|---|
| Google Cloud project + OAuth consent screen + iOS/Android client IDs | Google Drive sign-in | Free (up to 100 test users before Google's review) |
| Dropbox app (App folder) | Dropbox sign-in | Free (approval needed after 50 users) |
| Microsoft Entra app registration | OneDrive sign-in | Free |
| Box developer app | Box sign-in | Free |
| A domain + privacy policy page | Google/Microsoft require them before going public | ~₹800/year for a domain |

I'll give step-by-step instructions for each when we reach that step.

## 8. Risks

- **Testing sign-ins needs a development build.** Expo Go can't handle these
  sign-in redirects properly, so testing steps 2–5 needs the SideStore install
  working (paused: Wi-Fi) or an Android phone with the APK.
- **OneDrive's checksum (quickXorHash)** has no ready-made native version.
  JavaScript is fine for photos; for long videos it should become native code
  (otherwise the phone heats up).
- **Box free plans:** videos over 250 MB can't go there. Those fall back to Lens
  storage, with a notice.
- **Uploads run while the app is open** (same as today). True background upload
  is a separate piece of work.
- **Rate limits:** each provider limits requests. The connectors retry with
  backoff, as the Lens uploader does.
