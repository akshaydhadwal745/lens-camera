# Invite friends (+storage) and the affiliate program (commission)

Two separate programs. Design and decisions: [design/referrals-and-affiliates.md](../design/referrals-and-affiliates.md).

| | Invite friends | Affiliate program |
|---|---|---|
| Who | Every signed-in user | Approved partners |
| Reward | +10 GB Lens storage per friend (`REFERRAL_BONUS_GB`) | 50% of net revenue, lifetime (`AFFILIATE_RATE_BPS` = 5000) |
| Link | `/r/<code>` | `/go/<code>` (one per campaign, up to 20) |
| App | Settings → Invite & earn → Invite friends (`src/app/invite.tsx`) | Settings → Invite & earn → Affiliate program (`src/app/partners.tsx`) |
| Server | `infra/lambda/api/referrals.ts` | `infra/lambda/api/affiliates.ts` |

Shared: `attribution.ts` (codes, links, click tracking, who brought a user) and `audit.ts` (audit log).

## How a new user is attributed

One owner per new user, written once on their profile (`attribution`):
1. **Android install from a link:** `/r/` or `/go/` redirects Android visitors to Google Play with `referrer=lens_ref=<code>` (or `lens_aff=`). On first launch the app reads the Play Install Referrer (`modules/lens-device`, `installreferrer:2.2`) and sends it as `ref` with `POST /v1/devices`. **Until the Play listing exists (`playUrl` empty) links go to the website home page.**
2. **Website sign-up:** the link sets the `__Host-lensref` cookie (30 days, HttpOnly); a brand-new web account picks it up.
3. **Typed code:** `POST /v1/referrals/claim {code}` within 7 days of joining (Invite screen → "Got a code from a friend?"). Accepts friend and affiliate codes.

Codes: 7 characters without 0/O/1/I/L. `RC#<code>` → owner + program.

## Invite friends: when the +10 GB is granted

When the friend **signs in** (email/Google) on a phone. Checks (`referrals.ts → check`):
- inviter still exists; within 30 days of joining;
- not the inviter (same canonical email: Gmail dots/+tags ignored; or any phone the inviter used);
- at least one of the friend's phones is **not an emulator** and has **never earned anyone a reward**;
- the friend's email has never earned anyone a reward.

Each email and each phone earns a reward once, ever (`RW#email#…`, `RW#fp#…` markers written in the **same transaction** as the grant, so races can't double-grant). More than `REFERRAL_VELOCITY_PER_DAY` (10) rewards for one inviter in a day are **held** for admin review instead.

A website sign-up is attributed at once but rewarded when that account first signs in on a phone. A guest that signs in to an existing account is not a new friend (its row is removed).

Grant: ledger item `BN#<time>` (+bytes) and `PROFILE.bonusBytes` (quota = base + bonus). Email to the inviter. Friend list states: joined → signed in → storage added / not eligible.

## Affiliate program

1. **Apply** (signed-in): name, channels, audience, optional PAN + UPI (AES-256-GCM, key derived from the server's private key; shown masked). Must accept the terms (`/affiliate-terms/`).
2. **Admin approves** → a first link is created and emailed. Suspend/reinstate/reject. Suspended partners' links stop attributing and new purchases get no commission.
3. **Purchases** (`recordPurchase`, idempotent per Play order id): net = gross − GST − store fee; commission = 50% of net, **pending 30 days**. Self-purchases (buyer used the partner's phone) are rejected. Funnel counters per link and day (`AS#<code>`): clicks, sign-ups, payers, net, commission.
4. **Refunds** (`recordRefund`): during the hold → reversed. Already in a payout → a negative line deducted from the next payout.
5. **Daily maintenance** approves commissions whose hold ended.
6. **Monthly payouts** (admin): `POST /v1/admin/payouts/run {month}` creates statements (minimum ₹1,000; TDS 2% once the financial year passes ₹20,000, 20% without PAN, catch-up on crossing). The payout sheet shows decrypted UPI/PAN for the manual transfer; then "Mark paid" with the UPI reference. **Confirm the TDS rules with the CA before the first payout.**

**Payments are not built.** Until Play Billing exists, purchases and refunds can only be fed in by invoking the Maintenance function:
`{"purchase":{"orderId","userId","grossPaise","taxPaise","feePaise"}}`, `{"refund":{"orderId"}}`.
Later: Play Billing + Real-time developer notifications → the same two functions.

## Admin

`src/app/admin.tsx` (Settings shows it to admins only). API under `/v1/admin/*` answers 404 to everyone else. Admins: emails in the CDK context `adminEmails` (`ADMIN_EMAILS`), or `admin: true` set directly on a profile in DynamoDB (the e2e test does this for a throwaway account).

## Audit log

Every attribution, reward, hold, commission change, approval, payout and admin decision: a DynamoDB item `AU#<entity>` (`GET /v1/admin/audit?entity=affiliate:<id>`) **and** a JSON object in the audit bucket (`AuditBucketName` output) with S3 Object Lock, 8-year retention. **Governance mode while testing; switch to compliance before launch** (`infra/lib/lens-stack.ts`).

## API

| Route | Who |
|---|---|
| `GET /v1/r/<code>`, `GET /v1/go/<code>` (website `/r/…`, `/go/…`) | public |
| `GET /v1/referrals`, `POST /v1/referrals/claim` | signed in |
| `GET /v1/affiliates/me`, `POST /v1/affiliates/apply`, `PUT /v1/affiliates/payout-details`, `POST /v1/affiliates/links` | signed in |
| `GET /v1/admin/affiliates?status=`, `POST /v1/admin/affiliates/<id>`, `GET /v1/admin/referrals/held`, `POST /v1/admin/referrals/<friendId>`, `POST /v1/admin/payouts/run`, `GET /v1/admin/payouts?month=`, `POST /v1/admin/payouts/<id>/<month>/paid`, `GET /v1/admin/audit?entity=` | admin |

## Website

`/affiliates/` (landing, EN/HI), `/affiliate-terms/`, the privacy policy (attribution, click data, KYC, audit, `__Host-lensref` cookie), terms §4a, pricing and help mention +10 GB per friend.

## Tests

`infra/scripts/e2e.sh`: invite link + cookie, install referrer, reward on sign-in, existing account / same phone / own phone / emulator earn nothing, typed code, web sign-up rewarded on phone sign-in, ledger; affiliate apply/PAN validation/approval, links, purchase → pending → hold → approve, duplicate order, refund in hold, payout + TDS, idempotent run, payout sheet, mark paid, clawback after payout, suspension, audit (DynamoDB + S3).

## Before launch

- Play listing → set `playUrl` (CDK context) so links go to Google Play with the referrer.
- Play Billing + RTDN → `recordPurchase` / `recordRefund`; real GST and fee per order.
- Object Lock → compliance mode.
- CA: confirm TDS (194H) rates/threshold and GST on commissions.
- Play Integrity (stronger emulator/fake-device check).
