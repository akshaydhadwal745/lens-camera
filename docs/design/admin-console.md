# Lens Console (admin) — audit and plan (2026-10-21)

Owner's brief: the admin panel is the control centre of Lens. Separate, secure authentication;
role-based access; real data only; dashboards, searchable tables, detail views; users, feedback,
moderation, affiliates, errors, system health, costs, settings; audit logs; maintainable, cheap.

## 1. Audit of what exists

### Security
| Finding | Severity |
|---|---|
| Admin shares the **user** identity: an admin is a normal Lens account whose email is in ADMIN_EMAILS (or `admin` on the profile). Same session tokens as the camera app and website (30-day sliding sessions), same Lambda, same API URL. A stolen user session of an admin = admin access. | High |
| No second factor; sign-in by email code or Google, both shared with the consumer flow. | High |
| Admin screen ships inside the consumer app bundle and the public `/app` web app (route visible to everyone; data is protected server-side: 401/404, verified 2026-10-21). | Medium |
| Admin API authorization was a single `identity.admin` flag (no roles). Roles + per-route permissions written 2026-10-21 (team.ts, not deployed). | Medium |
| The API Lambda's IAM role (read/write all data) also serves admin: no least privilege. | Medium |
| Audit log exists (S3 Object Lock, `audit()`), used for affiliates/payouts only — not for logins, views of user data, team changes (partly added). | Medium |
| No admin session list / revoke / timeout policy of its own. | Medium |

### Data available today (verified)
| Area | Source | Notes |
|---|---|---|
| Accounts | `D#<id>/PROFILE` (createdAt, email?, usedBytes, bonusBytes), `ID#email` | guest vs signed-in derivable |
| Activity | session rows `D#<id>/T#…` (lastUsedAt) | DAU/WAU/MAU via nightly rollup |
| Media | `D#<id>/M#…` (kind, size, createdAt, uploadedAt, status, place) | uploads/day, photos vs videos, storage |
| Sharing | share requests, `SM#`, `LK#` links, albums `AS#`, events `EV#` | counts, funnel |
| Feedback / reports / contact | `FEEDBACK`, contact rows | reports = kind `report` |
| Affiliates / referrals / payouts | affiliates.ts, referrals.ts | existing admin APIs |
| Phones | `PHONES#<month>` (new) + `diag/` S3 | Admin → Phones |
| Storage | CloudWatch S3 `BucketSizeBytes` (1.9 GB now) | daily |
| Errors | Sentry (from dev-141) | needs a read-only Sentry token in SSM |
| Health | CloudWatch Lambda errors/duration/throttles, Batch transcoder jobs, SES | |
| Costs | AWS Cost Explorer (ce:GetCostAndUsage, $0.01/request) | cache once a day |
| Scale | DynamoDB 6,434 items / 1.2 MB, on-demand | nightly scan rollup ≈ free |

### Missing
Overview dashboard, trends, user search and user detail, moderation queue for reports, system
health, errors, costs, settings, admin sessions, consistent design.

## 2. Architecture

- **Lens Console**: its own web app (Vite + React + TypeScript, small chart library), its own
  deploy. Not in the camera app or the public `/app` bundle (the in-app Admin row is removed).
- **Address (owner, 2026-10-21)**: `console.lens.instagrowapp.com` (own origin: user-site scripts can
  never reach admin cookies). Needs one DNS record at Hostinger + a certificate (owner, guided).
- **Admin API**: a separate Lambda (`AdminApi`) behind the same CloudFront (`/console-api/*`,
  edge secret), own least-privilege IAM role (read data; write only what admin actions need;
  Cost Explorer + CloudWatch read). Reuses existing modules (feedback, affiliates, phones…).
- **Auth (independent of user accounts)**: Google sign-in with a **separate OAuth client** →
  server verifies the Google ID token → email must be on the admin team → **mandatory TOTP
  (authenticator app) second factor**, required for every admin (owner, 2026-10-21), enrolled at first login → server-side session: random
  token in an HttpOnly, Secure, SameSite=Strict cookie scoped to the console origin; 30 min idle,
  12 h absolute; CSRF header on writes; login rate limits; session list + revoke; all logins
  audited. Owners from config; team managed in the console.
- **Roles**: owner (everything + team + settings), admin (everything but team), support (users
  read, feedback, reports, inbox, phones), finance (affiliates, payouts), viewer (dashboards).
  Enforced server-side on every route; UI shows only allowed sections.
- **Privacy (owner, 2026-10-21)**: admins **never** see users' photos or videos — not even
  reported ones. The only images in the console are **screenshots a user attaches to their own
  feedback / problem report** (new: "Attach screenshot" in the feedback form, stored under
  `feedback/`, deleted with the feedback). Reports are moderated from metadata (reason, reporter,
  reported account, counts) with actions (block, suspend, revoke links). Views of user detail and
  attachments are audited.
- **Stats**: the daily Maintenance job writes `STATS#<day>` rollups (users, active, uploads,
  storage, shares, albums, links, events, feedback, reports); dashboards read rollups (fast,
  cheap). Live counters only where cheap.

## 3. Prioritized plan

| Phase | Scope | Days |
|---|---|---|
| P0 Security foundation | AdminApi Lambda + IAM, Google OIDC (separate client), TOTP, cookie sessions, roles, audit of logins/actions, rate limits; remove Admin from the consumer app and `/app`; Console shell (layout, navigation, design tokens) | 2.5 |
| P1 Overview | nightly rollup + backfill; Overview dashboard (users, active, uploads, storage, sharing, pending items) with 7/30/90-day charts | 2 |
| P2 Operate | Users (search, detail, actions: revoke sessions, adjust bonus storage, suspend, delete with confirmation), Feedback (with screenshot attachments: new in-app "Attach screenshot") + Reports moderation by metadata, Inbox, Affiliates/Referrals/Payouts moved over | 3.5 |
| P3 Health, errors, costs | Sentry issues, Lambda/transcoder health, AWS cost by service, Phones | 1.5 |
| P4 Team & settings | team/roles UI, admin sessions, settings that the app really reads | 1 |
| Test | e2e for every admin route + role, Playwright run of the console, owner walkthrough | throughout |

Total ≈ 10 working days. Each phase ships and is usable on its own.

## 4. Built (2026-10-21) — P0 + first P1/P2 views

- Certificate: stack `LensConsoleCert` (us-east-1 cert requested from ap-south-1 by a small function; DNS validation record at Hostinger). ARN in `cdk.json` `consoleCertificateArn`.
- Stack `LensConsole` (`infra/lib/console-stack.ts`): own CloudFront (`console.lens.instagrowapp.com`, strict CSP, HSTS, no framing, noindex), private site bucket, `/api/*` → `ConsoleApi` Lambda (function URL accepts only the console edge secret, `infra/keys/console-edge-secret.key`). The Lambda's role has **no media-bucket access**.
- Sign-in (`infra/lambda/console/session.ts`): Google code flow + PKCE + nonce (own OAuth client in SSM `/lens/console/google-client-id|secret`) → team check → authenticator code (RFC 6238, secrets AES-GCM sealed with SSM `/lens/console/key`, one use per code, 5 tries) → new session token in `__Host-lc` (HttpOnly, Secure, SameSite=Strict), 30 min idle / 12 h max. Writes need same Origin + `x-console` header.
- Roles (`roles.ts`): owner (ADMIN_EMAILS), admin, support, finance, viewer; 404 for routes a role can't use.
- Audit (`log.ts`): sign-ins, refusals, wrong codes, enrolment, team changes, account views, handled items → S3 Object Lock trail + `CAUDIT#<month>` feed (Activity log).
- Views (`console/`, Vite + React, no inline scripts): Overview (real numbers, test accounts excluded, 10-min cache, daily `STATS DAY#` snapshots), Users (search, account facts — never media), Feedback & reports, Inbox, Phones, Affiliates, Referrals, Payouts, Activity log, Team (roles, sign out, reset authenticator), Your sessions.
- Test traffic: `infra/scripts/e2e.sh` sends `x-lens-test: 1`; new accounts from it get `test: true`. Older test guests are inferred (created within 4 min of an e2e account).

Next: remove Admin from the camera app + old `/v1/admin` routes once the console is live; screenshot attachments in feedback; health/errors/costs (P3); user actions (P2).

## Added 2026-10-23
- **Backup codes:** 10 one-time codes (`xxxx-xxxx`) shown once when the authenticator is set up, and again from
  Your account → Backup codes → Make new codes (old ones stop). Each works once instead of the 6-digit code
  ("Lost your phone? Use a backup code" on the sign-in screen). Stored as hashes in `CADMIN#<email>/BACKUP`;
  removed with "Reset authenticator" or when someone is removed.
- **Second owner:** the main owner (ADMIN_EMAILS) can give the `owner` role in Team. Only the main owner can add,
  change, sign out, reset or remove an owner.
- **Alerts (hourly, EventBridge → console Lambda `{ alerts: true }`, `alerts.ts`):** email to all owners when a
  Health check is red (again every 12 h while red, then "fine again"), on an app error spike (a new Sentry issue
  with ≥ 10 events in its first 6 hours, or today ≥ 100 and > 3× the 14-day daily average), and for user reports
  not handled within 24 h (repeated daily). State in `STATS/ALERTS`.
