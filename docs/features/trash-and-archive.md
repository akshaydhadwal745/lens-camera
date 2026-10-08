# Delete, Trash and Archive

**Promise:** deleting is never a disaster. Deleted items stay in the **Trash**
for 30 days (free, instant restore), then in the **Archive** for a year
(recover the full-quality original in about 12 hours), then they're gone.

**Code:** app `src/lib/delete-flow.ts`, `src/app/trash.tsx`, `src/lib/store.ts`
(`deleteItems`, `refreshTrash`, `restoreItem`, `deleteForever`); server
`infra/lambda/api/trash.ts`, daily job `infra/lambda/api/maintenance.ts`.

## Deleting

Select → Delete in the gallery, or Delete in the viewer.

- The item is removed from **this phone** right away (original and previews).
- In the cloud it moves to the **Trash**.
- Items whose original **hasn't finished uploading** can't go to the Trash (there's
  nothing safe in the cloud yet). The confirmation says so, and they're deleted permanently.
- **Shared items** ask once more:
  - **Delete for everyone**: to the Trash; people you shared it with stop seeing it.
    Restoring it brings it back for them too.
  - **Only for me**: it leaves your library and stops counting toward your
    storage, but your friends keep it. When the last of them removes it, it goes
    straight to your Archive.

## Trash & Archive screen

Settings → **Trash & Archive** (phone and web). Two tabs:

| Tab | What you can do | Tile shows |
|---|---|---|
| Trash | **Restore** (instant, free) · **Delete forever** | days left before it moves to the Archive |
| Archive | **Recover** (about 12 hours) · **Delete forever** | months left before it's purged; "Recovering…" while on its way back |

**Delete forever** removes every copy (all stored versions). It can't be undone,
even from the Archive. Pull down to refresh.

## Timeline and storage

| Days after deleting | Where | Counts toward your storage | Getting it back |
|---|---|---|---|
| 0–30 | Trash | Yes | Instant, free |
| 30–395 | Archive | No | ~12 hours (free while testing; paid later) |
| 395+ | Purged | — | Not possible |

## How it works (engineering)

- Deleting is logical: the media record gets `deletedAt` and an index entry
  (`gsi1` `TRASH`, sorted by deletion time). The S3 original isn't touched.
- A **daily job** (EventBridge → `Maintenance` Lambda) walks that index:
  - Trash older than 30 days: tags the original `lens-archive=1`, sets
    `archived`, and releases the quota.
  - Recoveries in progress: once S3 says the object is readable, the item is
    put back in the library.
  - Archive older than a year: purged (all versions, previews, record, shares).
- **Archive storage:** the media bucket has an S3 Intelligent-Tiering config
  that sends **tagged** objects to the Deep Archive Access tier after 180 days
  unread (~$0.002/GB-month in Mumbai). The tag is only added when the Trash period
  ends, so items in the Trash are always instantly restorable. Compared with
  copying into Glacier Deep Archive, this has no per-object transition fee, no
  retrieval fee, no 180-day minimum, and no copy back.
- **Recover** (`POST /media/:id/restore`) on an archived item: if S3 hasn't
  moved it to the deep tier yet, it comes back instantly. Otherwise it starts a
  free Standard restore (~12 h) and the item shows "Recovering…".
- Quota counts an item while it's ready, visible to its owner and not archived.
- Recipients' **Shared** lists hide any item whose owner deleted it for everyone.

## Not built yet

- **Payment for Archive recovery** (decided: build later). Recovery is free
  while testing. Options: Apple in-app purchase (needs the paid developer
  account) or paying on the website.
- Multi-select restore in the Trash.
