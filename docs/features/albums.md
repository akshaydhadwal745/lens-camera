# Albums and bulk sharing (step 1 of docs/design/organise-and-share.md)

- **Albums**: roll → **Albums** chip → your albums (cover = newest item, count)
  and "Shared with you". Create (+), open, rename, delete (photos stay in the
  roll), select items → Remove from album. In the roll: hold a photo, pick
  more → **Add to album** (new or existing; items still uploading are skipped
  and said so). Up to 500 albums, 2,000 items each; a photo can be in several.
- **Shared albums**: album → **Share album** → same picker/confirm as sharing
  photos → one request per person ("wants to share the album “Goa trip”").
  On Accept the member gets the album's current items; items the owner adds
  later reach accepted members with no new request; removing an item from the
  album removes it from members (a separate direct share of the same photo
  stays); rename reaches members; revoke (Sent → Revoke) removes the album and
  its items; a member can **Leave**; deleting the album removes it from members.
- **Share while uploading**: picked items that aren't in the cloud yet are
  queued on the phone and sent to the same people as soon as each finishes
  (7 days max; deleted items are dropped).
- **Already in Lens**: importing from the phone gallery skips files whose exact
  bytes are already backed up (MD5 + size, photos ≤ 16 MB), with one notice.
- **Suggested people**: the share picker lists who you share with most first.

API and data: docs/design/organise-and-share.md. Tests: `infra/scripts/e2e.sh`
"albums, shared albums, duplicate check".
