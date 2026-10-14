# Recaps: trips and events, made for you

Lens finds the trips and events in your roll and offers each as a ready-made
album and a short film. Nothing is saved or shared until you choose
(design: docs/design/switch-features.md §4).

## What counts

- **Trip**: photos away from home (home = the city most of your photos with a
  place come from), across one or more days; gaps of up to 36 h stay one trip.
  Needs photos with a place (Settings → Camera → Save location) and at least 12.
- **Event**: 20 or more photos within 14 hours (a wedding, a party, a match),
  anywhere, no place needed.
- A stretch still going on (photos in the last 6 h) isn't offered yet.
- Near-duplicates (shots within 3 s: bursts, retakes) are dropped. The album gets
  up to 200 items, the film up to 30 photos spread over the whole time.
- Titles: "Goa · 12–15 Oct", or the date for events without a place, in your own
  time zone.

## In the app

The roll → **Recaps** chip → list (cover, TRIP/EVENT, title, how many) → open one:
every item, tap to leave one out, then **Save as album** (named after the recap;
your photos stay where they are) and/or **Make film**, or hide it (not suggested
again).

## The film

Made in the cloud, not on the phone (no heat, no battery): AWS Batch (Fargate
Spot, the transcoder image with `MODE=recap`, `infra/transcoder/recap.sh`) from the
photos' 2048 px previews. Each photo gets a slow push-in, photos crossfade
(2.6 s each), the title sits on the first shot; photos shaped against the frame
(landscape in a vertical film) are shown whole over a blurred copy instead of
cropped. Vertical 1080×1920 when most photos are portrait, else 1920×1080; H.264,
30 fps. About 2–3 minutes (≈ 30 s waiting for a Spot machine + ≈ 2 min rendering: 22 photos → a 44.6 s 1080×1920 film, 13.6 MB, measured 2026-10-14), counted in your Lens
storage. It lands in the roll right after the trip's photos as a normal video.

Cost: a 30-photo film is ~1 vCPU-minute on Spot (~$0.001) plus a few MB of storage.

## Server

`GET /recaps?tz=`, `GET /recaps/:key`, `POST /recaps/:key/album {ids?}`,
`POST /recaps/:key/film {ids?}`, `POST /recaps/:key/dismiss`
(`infra/lambda/api/recaps.ts`, detection `recap-detect.ts` with unit tests:
`cd infra && npx tsx --test lambda/api/recap-detect.test.ts`). Found on request,
nothing scheduled. State per recap: `D#<id> R#<key>`.
