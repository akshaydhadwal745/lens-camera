# Design: User referrals (storage) and Affiliate program (commission)

Status: **approved and built (2026-10-09)**, with the user's decisions below.
What was built: [features/referrals-and-affiliates.md](../features/referrals-and-affiliates.md).

**User decisions (2026-10-09)** (they override the proposals further down):
1. Commission = **50% of NET** (after GST and the Play fee).
2. **Lifetime recurring** (option C), not 12 months.
3. **No referral cap.** Instead, strong fake-account protection (once-per-email/phone, no self, no emulators, velocity hold).
4. Loose reward rule for launch: reward when the friend **signs in on a new phone**. No activation step (10 photos on 2 days) for now.
5. Build everything now; **wire payments later** (Play Billing → `recordPurchase` / `recordRefund`).
6. Manual monthly UPI payouts.
- Not answered, so set by config: friend's welcome bonus `REFEREE_BONUS_GB` = 0 (off).

Two separate programs with separate rules, ledgers and dashboards:

| | **User referrals** | **Affiliate program** |
|---|---|---|
| Who | Any Lens user | Approved partners (creators, photographers, bloggers) |
| Reward | **+10 GB Lens storage** (not money) | **50% commission** on what their referred users pay |
| Paid in | Storage quota | Money (UPI / bank), after a hold |
| Depends on | What exists today | **Payments, which are not built yet** (Play Billing) |
| Risk | Fake accounts farming free storage | Fraud + real money + tax compliance |

A person can be both, but one new user is attributed to **only one** program
(first valid touch wins, see §3), so we never pay twice for the same user.

## 1. What exists today (fit with our architecture)

- **Identity:** guest → account (email code / Google), device fingerprint
  `FP#<hash>`, disposable-email block, per-IP brake. Good anti-abuse base.
- **Quota:** `quotaFor()` = 5 GB guest / 100 GB signed in. A referral bonus
  becomes a third term: `100 GB + bonusBytes`.
- **Data:** DynamoDB single table (`D#<id>` partitions + GSIs), Lambda API,
  Maintenance Lambda (daily jobs), SES email, website on CloudFront with
  `/api`, account deletion. Everything below reuses these.
- **Payments: none.** Affiliate commissions hang off purchase events. **Step 0
  of the affiliate program is building payments** (Google Play Billing
  subscriptions + server verification + real-time developer notifications).
- **Push notifications: none yet.** Rewards are announced by email + in-app
  banner until push exists.

## 2. User referrals: +10 GB

**Rule (proposed):** the referrer gets **+10 GB** when someone they invited:
1. installs Lens from their link (or enters their code within 7 days of sign-up),
2. **signs in** with a verified email or Google account (no disposable emails;
   already enforced),
3. is genuinely new: email/Google never seen before, **device fingerprint never
   seen before**, not the referrer's own device/account,
4. **activates:** backs up at least **10 photos/videos taken on at least 2
   different days** within 30 days. Fake accounts rarely do this; real users
   do it in their first week.

When step 4 completes, the reward is granted **instantly and automatically**
(an email: "Your friend joined Lens, +10 GB added"). Steps 1–3 alone grant
nothing: that is the cheap path abusers use.

**Recommended extras:**
- **Two-sided:** the new user also gets +5 GB (or +10 GB). Two-sided referrals
  convert much better, and cost the same storage at worst.
- **Cap:** max **10 referrals = +100 GB** per user (lifetime). Keeps the worst
  case bounded. Dropbox famously capped theirs.
- Bonus storage **never expires** once granted; if a referral is later found
  fraudulent, the bonus is revoked. If they're over quota, **nothing is deleted**:
  new uploads just pause, as today.

**Cost:** storage is only paid for when used. 10 GB fully used costs about
**₹4/month** once photos are older than 90 days (Intelligent-Tiering's
archive-instant tier, ~$0.004/GB) and up to ~₹21/month if all of it is fresh
(~$0.025/GB). A user at the 100 GB cap who has filled it all costs
₹35–210/month; few will. The cap is what keeps the worst case bounded.

## 3. Attribution (shared by both programs)

**Links:** `lens.instagrowapp.com/r/<code>` (user referral) and
`lens.instagrowapp.com/go/<code>` (affiliate). The page:
- counts the click (aggregated per day; raw click records kept 30 days for
  fraud checks, IP stored hashed),
- shows a landing page with the inviter's name or affiliate's page,
- on Android: sends to the Play Store with the code in the **Play Install
  Referrer** (`&referrer=lens_ref%3D<code>`). The app reads it once on first
  launch (Google keeps it 90 days after install) and sends it when the
  identity is created. This is exact, privacy-safe attribution with no
  fingerprinting,
- on the web: a first-party cookie (30 days) for web sign-ups,
- everywhere: the **code** can also be typed in the app (Settings → Have a
  code?) within 7 days of sign-up (the fallback for iPhone and for word of mouth).

**Rules:**
- **One owner per new user, locked at sign-up.** Last valid click before
  install wins (industry norm), but a code typed by the user beats a link
  click. It never changes afterwards.
- **Attribution window:** click → install within **30 days**; install → sign-up
  within **7 days**.
- Self-referral is impossible: same account, same device fingerprint, same
  email/Google, or the same payment account (affiliates) → no credit.

## 4. Affiliate program: 50% commission

**Important business decision: 50% of what?** Recommendation: **50% of net
revenue** (what we actually receive). Example: a ₹99/month plan

| | Amount |
|---|---|
| User pays (incl. 18% GST) | ₹99.00 |
| GST to government | −₹15.10 |
| Google Play fee (15% of price excl. tax) | −₹12.59 |
| **Net revenue** | **₹71.31** |
| 50% of net to affiliate | ₹35.66 |
| 50% of **gross** would be | ₹49.50 → only ₹21.81 left for us, before storage cost |

**Commission duration (needs your decision):**
- **(A) recommended:** 50% of net on the referred user's payments for their
  **first 12 months**. Strong for affiliates, bounded for us.
- (B) first payment only: cheapest, but weak motivation.
- (C) lifetime recurring: most attractive, but forever cost; usually 20–30% when lifetime.

**Commission lifecycle:**
1. **Pending:** created when Google confirms a payment (server-verified via the
   Play Developer API + real-time notifications, never trusted from the app).
2. **Locked → Approved** after a **30-day hold** (refunds, chargebacks and
   cancellations show up via Play's Voided Purchases API / notifications).
3. **Reversed** if refunded/charged back during the hold. If after payout:
   deducted from the next payout (negative balance carried).
4. **Paid** monthly once approved earnings reach the **minimum payout (₹1,000)**.

**Eligibility rules for affiliates (in their agreement):**
- No self-purchases, no buying through their own link, no incentivized
  installs ("install and get ₹10"), no fake reviews, no spam.
- No bidding on our brand in Google Ads, no fake coupon sites.
- **#ad / paid-partnership disclosure** on social posts (ASCI guidelines).
- Accounts must be **approved** (simple application form) before links work.

**Fraud prevention (automated checks + review queue):**
- Device fingerprint / account / payment-account overlap between affiliate and buyer.
- Click spikes from one network, clicks with no installs, installs with no
  sign-ups (bot farms).
- Very high refund rates.
- Very fast install-to-purchase times.
- New affiliates' first payout reviewed manually.

**Payouts and tax (India):**
- KYC before the first payout: **PAN** (mandatory), UPI or bank account, name
  match; GSTIN if they have one. PAN/bank data encrypted (KMS), shown masked.
- **TDS under Section 194H: 2%** once an affiliate's commission in a financial
  year exceeds **₹20,000** (20% if no PAN). Monthly TDS deposit + quarterly
  returns + Form 16A. **Please confirm with your CA**: these are 2025
  figures and depend on your business structure.
- Payout method: start with **manual monthly UPI/bank transfers** from an
  exported payout sheet (no fees, fine for the first ~100 affiliates); later
  **RazorpayX Payouts** API (automated UPI/IMPS, small per-payout fee).

## 5. Data model (DynamoDB, same table)

| Item | Key | Notes |
|---|---|---|
| Referral code | `RC#<code>` → userId | One per user, created on first share |
| Affiliate | `AF#<id>` PROFILE | status (applied/approved/suspended), KYC (encrypted), payout method, terms version |
| Affiliate link | `AL#<code>` → affiliateId, campaign | Several per affiliate (per platform/campaign) |
| Click stats | `AS#<code>#<day>` counters | Aggregated; raw clicks `CL#…` TTL 30 days |
| Attribution | on the new user's profile: `attribution {program, code, ownerId, source, at}` | Write-once (conditional put) |
| Referral | `D#<referrer>` sk `RF#<newUserId>` | state: joined → signed-in → activated → rewarded / rejected(reason) |
| Bonus ledger | `D#<user>` sk `BN#<time>#<id>` | +10 GB grants / revocations; profile `bonusBytes` = sum (transaction) |
| Commission | `AF#<id>` sk `CM#<orderId>` | amounts in paise, status, hold-until, purchase/void refs; idempotent by Play order id |
| Payout | `AF#<id>` sk `PO#<month>` | gross, TDS, net, reference, status |
| **Audit log** | `AU#<entity>#<time>` + **S3 Object Lock** copy | Every state change (who/what/why); append-only |

Money is stored in **integer paise**; every write is idempotent (keyed by Play
order id / referral id) so retries never double-pay or double-grant.

## 6. Dashboards

- **App → Settings → Invite friends:** your link/QR, share buttons, progress
  ("3 of 10 friends joined, +30 GB earned"), each friend's step (joined /
  signed in / activated).
- **Website → /partners** (affiliates, signed in with their Lens account):
  - links and QR per campaign
  - clicks → installs → sign-ups → paying users (funnel)
  - pending / approved / paid earnings
  - payout history with TDS
  - KYC and payout details
  - creative assets, terms
- **Admin (internal, website /admin, allow-listed accounts):** approve
  affiliates, fraud queue, holds, monthly payout run + export, audit search.

## 7. Notifications

Email now (SES, already set up), push later (backlog). Notifications:
- "Friend joined" (no reward yet)
- "+10 GB added"
- affiliate "new paying user"
- "commission approved"
- "payout sent"
- monthly statement

All transactional; no marketing emails without opt-in.

## 8. Build order

1. **User referrals** (works without payments): codes/links, `/r/` landing page +
   Play Install Referrer, attribution, activation check, +10 GB ledger + quota,
   invite screen, emails, abuse checks, audit log, e2e tests. **~1 week.**
2. **Payments** (prerequisite for affiliates): Play Billing plans, server
   verification, real-time developer notifications (Pub/Sub → API), refunds.
3. **Affiliate program:** application + approval, links, commission engine
   with hold/reversal, partner dashboard, payouts + TDS records, admin tools,
   affiliate terms page, privacy-policy update.

## 9. Growth view

- Referrals cost only storage, and only when someone real joins and uses Lens. It
  is the cheapest acquisition channel; the event albums feature will feed it
  (everyone invited to an album is a natural referral).
- Affiliates bring paying users; at 50% of net for 12 months, a ₹99/month user
  still leaves ~₹35/month for us, and after 12 months all ₹71. Sustainable
  only on **net** revenue with holds and caps.
