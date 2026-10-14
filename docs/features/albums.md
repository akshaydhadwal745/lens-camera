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

## Event albums (QR / link)

Turn any of your albums into an event album: **Invite with QR** (album screen).
Lens asks first, because anyone with the link or QR code can then see the album
and add their photos. The Event QR screen shows the code, the link
(`lens.instagrowapp.com/e/<code>`), Share link / Copy, and **Turn the link off**
(the code stops working at once; people already in stay).

- Guests scan the QR with any camera (or the Lens camera / Lens scanner, which open
  it in Lens) → the event screen (name, who made it, previews) → **Join and add
  photos**. Joining is their own consent: no share request.
- Members see everyone's photos (Shared list + the album) and **Add photos** from
  their roll (cloud items only). Photos stay in each person's storage and quota.
- Who added a photo, or the owner, can remove it; leaving takes your photos with you.
- The album refreshes every 15 s while open; everyone in it gets one notification
  per batch ("Asha added 12 photos").
- Without Lens, the link opens a web page with the album's previews and "Open in
  Lens" / "Get Lens". Adding from the browser comes next.
- Limits: 500 people per event, 500 items per person, 2,000 items per album,
  rate limits on views (per network), joins and adds.

API: `POST /albums/:id/event {on}`, `GET /events/:code` (public),
`POST /events/:code/join`, `POST /shared-albums/:owner/:album/items`,
`GET /shared-albums/:owner/:album/mine`, `DELETE /shared-albums/:owner/:album/items/:id`,
`DELETE /events/:code/members/me`.

