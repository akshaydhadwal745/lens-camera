# Share links (2026-10-16)

Send photos and videos to people **without Lens** through WhatsApp, messages or
any app: `https://lens.instagrowapp.com/s/<token>`.

## For the user
- **Make one:** pick items → Share → **Share by link**. The sheet shows exactly
  which items go in ("Only these 3 items. Not your albums or the rest of your
  library."), then:
  - **Who can open it:** *Anyone with the link* (they see the items in their
    browser, or in Lens) or *Only one person* (the web page shows nothing; the
    first person who opens it in Lens gets the items, nobody else ever can).
  - **Link works for:** 1 day, 7 days (default) or 30 days.
  - **Include where they were taken:** off by default (location removed).
  - **Create link** → **Copy** or **Send…** (Android share sheet).
- **Albums can't be shared by link** (the option isn't shown for albums, and the
  API refuses `albumId`); at most 20 items per link.
- **Settings → Sharing → Share links:** every link, Works / Expired / Turned off /
  Opened, views, who opened it in Lens; **Turn off** ends the link and removes
  access for everyone who opened it in Lens.
- **The recipient:**
  - *Lens installed:* the link opens Lens (App Link `/s/`); opening it there is
    their accept: the items land in **Shared**, in full quality, and the sender's
    Sent list shows "… to Riya (by link)".
  - *No Lens:* a phone-first web page (`site/src/pages/s/`) shows the items
    (previews; videos play the location-safe original), **Save photo/video**, and
    a bar with **Open in Lens** / **Get Lens**. iPhone: the page is the fallback
    (Lens for iPhone isn't public yet).
  - *After installing:* the first launch opens exactly what was shared
    (deferred deep link, below). No searching, no asking again.

## Deferred deep link (link → install → first launch)
- **Play (once listed, `PLAY_URL` set):** "Get Lens" goes to Play with
  `referrer=lens_share=<token>`; the app reads the install referrer at its first
  registration (`markFreshInstall`, `src/lib/share-link.ts`).
- **Website APK (now):** Android can't pass data through a sideloaded install, so
  both buttons copy the link before leaving the page; on the first launch after
  registering, Lens checks the clipboard **once** and takes it only if it is a
  Lens share link (Android 12+ shows its "pasted from your clipboard" notice).
- Also: scanning a link's QR code in Lens opens it (`src/app/scan.tsx`).
- Open: `src/app/s/[token].tsx` → `POST /links/:token/open` → refresh Shared →
  the viewer (one item) or the Shared tab.

## Security and privacy
- Token: 128 random bits (22 base64url chars); unguessable; the public view is
  rate-limited per IP (600/hour).
- Only the owner's own uploaded items; deleted (Trash) or hidden items drop out
  of every link at once.
- Location: same as shares — a copy with GPS (photo EXIF) or the location boxes
  (video) wiped, unless the sender included it; place/gps never in responses.
- Expiry stops the web view and new opens; people who already opened it in Lens
  keep it like any accepted share until the sender turns the link off or revokes
  that share in Sent. One-person links are claimed with a conditional write (two
  phones racing can't both win). At most 50 people can open an "anyone" link in
  Lens. Opening a link from someone you blocked is refused.
- Account deletion deletes the owner's links (`deleteLinksOf`).

## Server (`infra/lambda/api/links.ts`)
| Route | |
|---|---|
| `POST /v1/links {mediaIds, expires, mode, includeLocation}` | create (owner) |
| `GET /v1/links` | my links + who opened them |
| `GET /v1/links/:token` (public) | sender, counts, status, `getUrl`; items only for active "anyone" links |
| `POST /v1/links/:token/open` | open in Lens = accept (`grantFromLink` in shares.ts) |
| `POST /v1/links/:token/revoke` | turn off + revoke every share it made |

Records: `LK#<token> LINK` (TTL 30 days after expiry), `LK#<token> M#<id>`
(location-free copy key), `D#<owner> LKO#<token>`. CloudFront rewrites `/s/*` to
`/s/index.html`. Cost: no new services (DynamoDB on demand, the API Lambda, the
static page; video copies only for videos shared without location).

e2e: `infra/scripts/e2e.sh` "Share links".
