# Places (step 2 of docs/design/organise-and-share.md)

- **Where positions come from:** only the GPS tag the camera writes into a photo
  when **Save location** is on (Settings → Camera; off by default). On upload
  the phone reads it from the photo's own file (`src/lib/exif-gps.ts`) and sends
  `gps` with the upload. Photos uploaded before are backfilled once from this
  phone's copies when Places opens (`backfillPlaces`, `POST /media/places`).
- **Place names without a paid API:** the server picks the nearest city from a
  bundled GeoNames list (`infra/lambda/api/data/cities.txt`, 34,160 cities with
  15,000+ people, CC BY 4.0): the biggest city within 6 km (a suburb joins its
  city), else the nearest within 100 km, else none. Positions never leave our
  servers. Stored as `gps` (3 decimals ≈ 100 m) + `place {city, region, country}`.
- **Screens:** roll → **Places** chip → places with cover, region/country, count
  and dates → a place's photos. Day markers in the roll show the day's main city
  ("12 OCT · CHANDIGARH · 14 FRAMES"). Empty Places explains and offers **Save
  location in new photos** (the permission is asked then, never at launch).
- **Private when sharing (decision 2):** recipients never get `place`/`gps`; and
  photos with a position, shared without **Include where they were taken** (the
  confirm sheet's switch, off by default), reach them as a copy with the EXIF GPS
  block wiped: byte edits only, same pixels, same size (`exif-strip.ts`, made
  once at `d/<owner>/<id>/nogps.jpg (next to its previews)`, deleted with the account). Phone-made previews
  carry no metadata at all.
- **Videos (2026-10-16):** the phone reads the position from the video's `moov`
  box (`src/lib/mp4-location.ts`: Android `©xyz`, iPhone
  `com.apple.quicktime.location.ISO6709`, 3GPP `loci`); live uploads send it
  once the recording is finished; the backfill (`places-backfilled-v2`) also
  covers videos. Shared without location, the recipient's video is a copy whose
  location boxes are zero-filled `free` boxes (same size, same audio/video;
  `infra/lambda/api/video-strip.ts`: only the bytes around them pass through the
  Lambda, the rest is copied inside S3), made once at `d/<owner>/<id>/nogps.mp4`
  and reused by every recipient. Streams never carry location
  (`transcode.sh -map_metadata -1`). A video we can't read: stream/preview only.
- **Limits:** photos in the user's own storage get no copy
  (recipients see the preview only, as before); HEIC/RAW originals with a position
  shared without location: preview only.

Credits: place names from GeoNames (geonames.org), CC BY 4.0.
