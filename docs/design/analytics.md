# Product analytics (our own) — 2026-10-21

Owner's decision: our own analytics in our AWS and the Lens Console, no third party.

## What is recorded
| Row | Written by | What |
|---|---|---|
| `ACT#<YYYY-MM-DD>` / `<accountId>` | API `authenticate` (first request of the day, `usage.ts markActive`) | this account used Lens that day (`client` app/web) |
| same row, `f_<feature>` counters + `build`, `os`, `region` | app `POST /v1/usage` (`src/lib/usage.ts`) | how often features were used that day; counts only |
| `PROFILE.signedInAt` | sign-in (`auth.ts`) | first sign-in time (older accounts: earliest `ID#…` login row) |

- App counters: screen opens (`SCREENS` in `src/app/_layout.tsx`), `capture_photo|video`, `look_used` (store `capture`), `mode_<mode>`, `mode_pro`, `front_camera`, `timer_used` (shutter in ProCamera), `edit_saved`, `share_sheet`, `app_open`.
- Server counters (exact, all app versions): uploads, share links, friend shares, albums, event albums, invites, own storage, feedback.
- Off with Settings → Camera → **Help improve Lens** (same switch as diagnostics + Sentry); turning it off drops unsent counts.
- Retries count once (`batch` id, conditional `NOT contains(batches)`); days accepted up to 14 days back.
- Kept 400 days (TTL); account deletion removes the account's `ACT#` rows. Privacy policy row "How Lens is used".

## Console (Insights → Analytics, `infra/lambda/console/analytics.ts`)
Funnel (installed → backed up → signed in → shared → came back 7+ days later; 30/90/all days, median time to each step), active users (DAU/WAU/MAU, stickiness), weekly retention cohorts (from `ACT#`, starts 2026-10-21), feature use (people, share of active, uses, 12-week sparkline), breakdowns (build, Android, region, app vs web). Test accounts excluded (same rule as Overview). Cached 30 min.

## Scale
Computed from one full-table scan (fine to ~100k items). Next step when it grows: nightly per-day rollups (`STATS ADAY#`) + incremental cohorts.
