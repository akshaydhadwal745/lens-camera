# Maintenance scripts (run by hand)

| Script | What |
|---|---|
| `scan_gps_previews.py KEYS OUT` | Reads the first 64 KB of every `d/**/preview*.jpg` / `thumb*.jpg` in the media bucket (read-only) and lists the ones whose EXIF has a GPS block. KEYS = `aws s3api list-objects-v2 --bucket lens-media-495026846839 --prefix d/ --query 'Contents[].[Key,Size]' --output text`. |
| `clean_previews.py KEYS [--apply]` | Strips EXIF/XMP from those objects (same as `src/lib/jpeg-meta.ts`). Dry run by default; `--apply` backs each object up to `lab/backup-previews-2026-10-19/<key>` first. Needs the owner's OK (rewrites user data). |
| `peer.py` | A second "phone" on the live API (guest identity: upload, share, get/post). For sharing tests without a second device. Delete the identity afterwards: `DELETE /v1/account {"confirm":"DELETE"}`. |

All use the `lens` AWS profile. The 2026-10-19 GPS list is in `test-results/2026-10-19-s8/gps_previews.txt` (local only).
