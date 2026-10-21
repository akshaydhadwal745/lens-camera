# Payments, plans and storage limits (2026-10-21)

Owner decisions: Razorpay (website + APK; the Play Store app needs Google Play Billing or Google's
user choice billing), memories never disappear suddenly, 7-day grace, 5 months over the limit
before what's above it is deleted.

## Plan states (`infra/lambda/api/plans.ts`, on PROFILE.plan)
| State | Storage | How it gets there |
|---|---|---|
| active | plan (Plus 50 GB, Max 200 GB) + invite storage | payment / renewal (Razorpay webhook, Play RTDN, console grant) |
| grace (7 days) | still the plan's | renewal failed or didn't arrive (+1 day slack); reminders day 0/3/6 (push + email) |
| lapsed | Free 10 GB + invite storage | grace over, or a cancelled plan reached its paid end; nothing deleted |

Paying again → active immediately, no back payment. The 15-minute Maintenance tick moves states on time.

## Free model (welcome, soft landing)
Guests 5 GB → sign-in: 40 GB for 3 months (+1 month if invited) → 14-day soft landing (still 40 GB, reminders) → 10 GB free forever + invite storage (+10 GB per friend, ≤ +100 GB; event hosts +1 GB per 10 contributing guests, ≤ +5 GB).

## Over the limit (`over-limit.ts`, daily at ~10:00 local via lifecycle.ts)
- Nothing blocked or deleted at first: view, download, share all work; only new Lens backups pause (`checkQuota` → 413 `free-quota`; the app shows "Backups paused: N photos wait", and restarts uploads by itself when there's room).
- `PROFILE.overLimitSince` starts the clock; clears when within the limit (paid, invites, deletes, own storage).
- Reminders: first notice, then monthly; deletion notices 90/30/7/1 days before (push + email, "account" category — can't be turned off).
- After 150 days (5 months): delete Trash items first, then most recent backups, until within the limit (max 2,000 items per run; re-reads the profile first; audit `storage.deleted-above-limit`).
- Terms §4 (EN/HI) and FAQs state this.

## Console (Users → account)
Shows plan, welcome, over-limit date and deletion date; support can give N months of a plan, mark a payment failed, or end a plan (audited). Used for testing until Razorpay is live.

## Next: Razorpay + the "Lock in" offer (decided 2026-10-21 night; build 2026-10-22)
- **Option A:** after the free 3-month welcome, the 4th month of Lens Plus (50 GB) costs **₹19**, then **₹59/month** (or ₹499/year).
- **Offered at the start, optional:** a "Lock in Lens Plus" screen at sign-in and after the first 20 backups → Razorpay **UPI Autopay / card mandate, ₹0 today**, subscription starts when the welcome ends (₹19 first charge). "Not now" keeps the free welcome; the offer comes back at 80% storage, after a trip recap and in the last welcome week; the ₹19 price ends with the welcome.
- RBI e-mandate: Razorpay's pre-debit notice + our reminder 3 days before the first charge; one-tap cancel in the app and on the website.
- Razorpay webhooks → `activatePlan` (paid/renewed), `paymentFailed` (7-day grace), `cancelPlan` (ends at period end).
- Where: website + APK. The Play Store app must use Google Play Billing (intro price / free trial) or Google's user choice billing (Razorpay beside Play, 11% fee).
- Keys: the owner's account is LIVE-only → its dashboard **Test Mode** switch for test keys (Key ID + Secret in `~/Downloads/razorpay-test.txt`, stored in SSM `/lens/razorpay/*`); live needs the account's Subscriptions feature enabled.
