# Extra storage above Lens Plus (₹3 per GB a month)

Owner decision 2026-10-26, after the pricing evaluation
([business/pricing-models-evaluation.md](../business/pricing-models-evaluation.md)):
- Keep Lens Plus at 50 GB for ₹59/month or ₹499/year.
- On top of it, people can keep storage above 50 GB and pay **₹3 per GB per month only for what
  they keep**. They opt in with a monthly limit.

At ₹3 the margin is 58 % for a rarely-opened archive, 34 % for a typical user and 11 % for a heavy
video user. These figures are through Razorpay, on AWS as it is today.

## How it works

| | |
|---|---|
| Who | Lens Plus **monthly** paid through Razorpay (website and website APK), running and not cancelled. Yearly Plus: not yet (no monthly payment to add to). Play app: +10 GB packs for ₹30 a month once Play Billing exists. |
| Price | ₹3 per GB-month, GST included = 10 paise per GB per day |
| Measuring | Once a day (lifecycle tick, ~10:00 on the phone): GB above plan + invite storage, added to `gbDays` (capped at the limit) |
| Limit (cap) | 10 / 20 / 50 / 100 GB, chosen by the person. The limit is also the storage limit: backups above 50 GB + limit pause (413 `extra-cap`). So the most a month can cost is limit × ₹3 (₹30 / ₹60 / ₹150 / ₹300). |
| Consent | Turning on or raising the limit shows the price, the maximum and how billing works, and needs "Agree" (`agree: true` on the API). Every change is audited. |
| Alerts | 50 %, 80 %, 100 % of the limit, once each per period (push; email at 100 %) |
| Bill | 3 days before the Lens Plus renewal, `gbDays × ₹3 / 30` (never above the period's limit × ₹3). It's added to that payment as a **Razorpay subscription add-on**, so one Razorpay pre-debit notice covers the total. We send the exact total first (push + email): "₹59 + ₹X = ₹Y on <date>". Below ₹1 it carries over to the next month. |
| Lower / off | Allowed down to what's kept above the plan (otherwise they'd be over their limit at once). They free up space first: Move to Drive, download or delete. |
| Payment fails | The usual Lens Plus grace (7 days): extra storage keeps working. Nothing is blocked or deleted because of a bill. |
| Plus ends | Extra storage switches off (turning it on again asks again). An amount not yet added to a payment isn't charged. A cancelled Plus has no next payment, so its last month of extra storage is free. |
| Affiliates | The add-on is part of the paid invoice, so `recordInvoices` counts it automatically. |

## Code

| Piece | Where |
|---|---|
| State, metering, bill, alerts | `infra/lambda/api/extra-storage.ts`: `PROFILE.extra = { capGB, meterFrom, gbDays, lastDay, periodCapGB, billedFor, agreedAt }`; bills `D#<id>` / `XB#<subscription>#<periodEnd>` (8-year TTL) |
| Quota | `lib.ts quotaFor()` adds `extraAllowance()` (cap × GB while the plan gives storage, incl. grace); `checkQuota` → `extra-cap` |
| Daily run | `lifecycle.ts` calls `dailyExtra()` for accounts with `extra` (notices `extra_alert`, `extra_bill`) |
| API | `GET /v1/extra` (eligibility, usage, this period so far + estimate, last 12 bills); `POST /v1/extra {capGB, agree}` |
| App | `src/components/ExtraStorage.tsx` on the Lens Plus screen (running Razorpay Plus only); Storage shows "50 GB + up to N GB extra" |
| Console | Users → account → Storage plan → Extra storage (limit, use, this period, bills) |
| Terms / privacy | Terms §4 and privacy §1 payments row (EN + HI), updated 26 Oct 2026 |
| Tests | `infra/lambda/api/extra-storage.test.ts` (maths, quota, eligibility); e2e "extra storage" block (consent, cap, metering, Razorpay add-on ₹15.50, no double bill, 80 % alert, switch-off) |

## Before going live
- **Mandate amount:** check on the S8 test payment that a Razorpay UPI Autopay mandate made for a
  ₹59 subscription accepts ₹59 + add-on. Razorpay sets the mandate maximum, and RBI needs extra
  confirmation above ₹15,000. If the maximum turns out to be the plan amount, either:
  - create the subscription with a higher mandate maximum (Razorpay support), or
  - bill extra storage separately.
- Update the website pricing page (Plus + extra storage) together with the Lens Plus go-live.
- Play: +10 GB packs (₹30/month subscription products) when Play Billing is built.
