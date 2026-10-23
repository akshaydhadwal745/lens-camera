# Download everything

Settings → Storage → **Download everything** (app and web). Free: people have a right to a copy of
their data; downloads go through CloudFront (1 TB/month free tier).

- `POST /v1/export` starts one (one a week); `GET /v1/export` shows progress and, when ready, signed
  links (6 hours each, re-signed on every look) to the files.
- Maintenance `{ exportFor: <id> }` packs every original in Lens storage (not deleted, backed up
  before the start) into stored ZIPs of up to 3.5 GB / 60,000 files (no ZIP64), folders by year
  (`Lens/2026/Lens 2026-10-23 14.05.11 abcd1234.jpg`), streamed S3 → S3 with a multipart upload,
  one part per pass, continuing itself. Files over 1 GB get their own direct link.
- Files live at `x/<account>/<export>/` (bucket lifecycle: 7 days) and the links work for 6 days.
- Ready → push + email (link to lens.instagrowapp.com/app/storage).
- Originals already in the person's own storage aren't included (they are theirs already).

e2e: two photos → one ZIP, `unzip -t`, bytes compared, second export refused (`too-soon`).
