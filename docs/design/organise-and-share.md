# Organise and share: albums, places, nearby, people (agreed 2026-10-12)

The user's goal: richer organisation and sharing without making Lens
complicated, private by default, near-zero infrastructure cost, working on old
and new Android phones. Built **one step at a time**, each tested before the next.

| Step | What | Where it runs | Status |
|---|---|---|---|
| 1 | **Albums + smarter bulk sharing**: albums, shared albums (one request, later additions reach accepted members, revocable), share-while-uploading, exact-duplicate detection, recipient suggestions (frequency + album members) | JS + API (OTA) | **done** (deployed, e2e 246/246, emulator walk-through 2026-10-12) |
| 2 | **Places**: coordinates sent with the upload only when "Save location" is on; place names from the phone's own geocoder (no paid API); Places view; place on day markers; permission asked in context | JS + API (no native needed) | **done** (deployed, e2e 254/254, emulator walk-through 2026-10-12) |
| 3 | **Nearby** (same Wi-Fi): opt-in; phones exchange only short-lived random codes over mDNS; the server resolves a code to a display name only for people who opted in (identity verified by the server, not by network presence); only while the roll/share screen is open | native module + API | **done** (deployed, dev-79; emulator verified 2026-10-13; 2-phone test pending) |
| 4 | **People**: on-device face grouping (never uploaded; while charging; on previews); the user labels a group; suggestions "share with X?" only when X turned on "Let friends' Lens suggest me"; always review + confirm + recipient accepts; off by default; "delete all face data" | on-device | **designed** (docs/design/people.md, waiting for user OK) |

## Decisions (user, 2026-10-12)

1. Faces: **on the phone only, opt-in, built last** (no cloud biometric data).
2. Location when sharing: **private by default** (confirm sheet shows "N photos include location" with a switch to include it).
3. Nearby visibility: **anyone on the same Wi-Fi who also opted in** sees the display name only.

## Step 1 design

### Data (existing DynamoDB table)

| Item | Meaning |
|---|---|
| `D#<owner>` `AL#<albumId>` | album: name, createdAt, updatedAt, count, coverId |
| `D#<owner>` `AI#<albumId>#<mediaId>` | membership (a photo can be in several albums; deleting an album never deletes photos) |
| `D#<owner>` `AM#<albumId>#<memberId>` | a person who accepted the shared album (shareId) |
| `D#<member>` `SA#<albumId>#<ownerId>` | the shared album in the member's Albums view |
| `D#<id>` `H#<md5>#<size>` | checksum of an uploaded original → mediaId (exact-duplicate check) |

A shared album is a share request carrying `albumId`/`albumName` (same statuses,
same accept / decline / cancel / revoke). Access stays per item (`S#` records,
now with `albumId`): written on accept, and for each accepted member when the
owner adds items later; removed on revoke or when an item leaves the album.

### API

`GET/POST /albums`, `GET/PUT/DELETE /albums/:id`, `POST /albums/:id/items {add, remove}`,
`POST /shares {albumId, to}`, `GET /shared-albums`, `POST /media/check {md5, size}`.

### App

Roll → **Albums** filter (your albums + "Shared with you"); album screen (rename,
delete, share, remove items); selection → **Add to album**; share screen accepts
an album; items still uploading are queued and sent when they finish;
gallery import skips files already in Lens.
