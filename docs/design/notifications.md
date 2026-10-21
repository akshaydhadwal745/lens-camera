# Notifications (2026-10-21)

Goal (owner): useful, timely notifications that bring people back, never spam; campaigns managed
in the Lens Console with targeting, scheduling and metrics. Built on our own FCM sender
(`infra/lambda/api/push.ts`), no third party.

## Kinds
| Kind | Examples | Rules |
|---|---|---|
| **Event** (`notify`) | someone shared with you, accepted, a friend joined (+10 GB), event photos added, Lens storage 90% full | sent at once, category preference only |
| **Lifecycle** (`lifecycle.ts`, hourly) | welcome ending (14/3/1 days, + email at 14 and 1), backups paused, weekly summary (Sundays), recap ready, on this day (≤ weekly) | once each (markers `NL#…`), ~10:00 local, daily limit |
| **Campaign** (Console → Notifications, `campaigns.ts`, every 15 min) | features, tips, announcements | audience filters, schedule, 9:00–21:00 local, daily limit, News ≤ 1/week, expires after 24 h |

## Categories (Settings → Notifications; Android channels in `src/lib/local-notify.ts`)
`shares`, `invites`, `storage`, `memories`, `summary`, `news` can be turned off. `account` (storage
plan notices) always comes, as it's about the user's own storage. Limits: 2 lifecycle/campaign
notifications per person per day (`NCAP#<id>`), News 1 per ISO week. Quiet hours use the phone's UTC
offset sent at push registration (`tz`); phones that never sent one count as India (+5:30).

## Metrics
- Campaign rows count targeted, sent, failed, off (category turned off), capped, no-device, expired and opened. The app reports taps with `POST /v1/notifications/opened`, using the campaign id or lifecycle name in the payload.
- Daily counters `NSTAT <day>#<result>#<name>` track lifecycle sends and opens, plus opt-outs per category.
- Delivery: "sent" means FCM accepted it. Actual on-screen delivery isn't reported by FCM's HTTP API.

## Audience filters
Signed in or guest; plan (welcome, free or guest); active in the last N days or inactive for N days; installed within N days; Lens storage at least X% full; has shared or never shared; region; app build. Test accounts are always excluded. A test send goes to the console user's own Lens account (same Google email).

## Tests
e2e: categories, opt-out, opens, estimate, validation, test-send guard, a campaign to one test account (`runCampaign`), welcome-ending marker via `lifecycle.onlyOwner`.
