# Pricing models: fixed vs pay-as-you-go vs hybrid (evaluation, 2026-10-26)

Question from the owner: should Lens add **pay-as-you-go (PAYG) storage**, from day one or after a
40 GB / ₹60 plan, instead of only fixed plans? This document checks the numbers before anything is
built. Nothing here is implemented. The model scripts are in `research/pricing/`. Run them with
`python3 -I research/pricing/pricing_model.py`, then `pricing_v2.py` … `pricing_v5.py`, from that
folder.

**Decision (owner, 2026-10-26):**
- Keep Lens Plus at 50 GB for ₹59.
- Add **extra storage at ₹3 per GB-month** on top, opt-in with a limit, billed with the monthly Plus
  payment. Built: [features/extra-storage.md](../features/extra-storage.md).
- The cost levers in §7 are still open.

**Short answer (the evaluation before the decision):**
- **Don't build per-GB-month PAYG** and don't change Plus to 40 GB for ₹60.
- **Keep fixed plans.** Send heavy users to their own Drive. Keep pay-per-use for one-off actions
  (as Move to Drive already does).
- **The real problem is cost, not the price model.** Free users and the 40 GB welcome cost far more
  than any paid model brings in. Fix that before scaling.

## 1. Cost per GB (AWS Mumbai list prices, $1 = ₹88)

| Item | Price | Per GB of originals |
|---|---|---|
| S3 Intelligent-Tiering: frequent (<30 d) / infrequent (30–90 d) / archive instant (>90 d) | $0.025 / $0.0138 / $0.005 per GB-month | ₹2.20 / ₹1.21 / ₹0.44 |
| Previews + thumbnails (made on the phone, ~12.5 % of original size, S3 Standard) | $0.025 | +₹0.28 / month |
| Tiering monitoring + 30-day old-version keeping | — | +₹0.09 / month |
| **Second copy** (not built today: no replication, no DynamoDB PITR). Proposed: Glacier Deep Archive in another account | $0.002 | +₹0.18 / month (+₹1.10 once) |
| Upload requests (3 objects per photo) | $0.005 / 1,000 | ₹0.35 once |
| Video streaming copy (Fargate Spot HLS) | $0.0127 / vCPU-hour | ~₹0.45 once per GB of video |
| **Delivery** (CloudFront to India; first 1 TB/month free in total) | $0.109 / GB | **₹9.59 per GB viewed or downloaded** |
| Drive move / export egress | same | ₹9.59 per GB |
| Razorpay | 2 % + 18 % GST on the fee | 2.36 % of the price |
| Google Play | 15 % of the price after tax | 15 % |
| GST (India prices include it) | 18 % | price ÷ 1.18 |

What we keep from each rupee: **₹0.82 via Razorpay and ₹0.72 via Play.** So ₹59 → ₹48.6 (Razorpay)
and ₹42.5 (Play).

### All-in cost by user type (library about a year old, second copy included)

| User | Stored | Cost / month | **Cost per GB** | Storage alone |
|---|---|---|---|---|
| Occasional photos | 5 GB | ₹8 | **₹1.65** | ₹1.03 |
| Typical, mixed | 20 GB | ₹33 | **₹1.64** | ₹1.09 |
| Heavy video (streams 3 GB/month) | 40 GB | ₹88 | **₹2.21** | ₹1.21 |
| Large, rarely opened archive | 100 GB | ₹104 | **₹1.04** | ₹0.84 |
| Free user (avg 4 GB) | 4 GB | ₹5.9 + ₹1.4 viewing | — | — |
| Welcome user (40 GB for 3 months, adds ~3 GB/month) | ~9 GB | ₹24 | **≈ ₹71 per sign-up** | — |

Key points:
- **Delivery, not storage, drives heavy users' cost.** ₹9.59 for each GB they watch or download is
  about 10× the monthly cost of keeping that GB.
- **New data is expensive and old data is cheap.** A fresh GB costs ₹2.5 a month and a cold GB
  ₹0.8. The cost of a user who keeps adding photos stays high.
- **S3 hardly gets cheaper with scale.** It drops about 4 % above 50 TB. CloudFront drops at 10 TB
  a month, and private pricing comes later. Libraries only grow, so **the cost per user goes up
  every year while a fixed price stays flat.**

## 2. Minimum viable price per GB-month

60 % of payments through Play and 40 % through Razorpay:

| User | Break-even | 50 % margin | 70 % margin |
|---|---|---|---|
| Occasional / typical | ₹2.15 | ₹4.30 | ₹7.20 |
| Heavy video | ₹2.90 | ₹5.80 | ₹9.70 |
| Cold archive | ₹1.36 | ₹2.72 | ₹4.54 |

Compare per GB of capacity:

| Plan | ₹ per GB |
|---|---|
| Google One Lite, 30 GB ₹59 | ₹1.97 |
| iCloud, 50 GB ₹75 | ₹1.50 |
| **Your idea, 40 GB ₹60** | **₹1.50** |
| Google One, 100 GB ₹130 | ₹1.30 |
| **Lens Plus, 50 GB ₹59 (current)** | **₹1.18** |
| Google One, 200 GB ₹210 | ₹1.05 |
| Lens Max, 200 GB ₹149 (defined, not sold) | ₹0.74 |

Google and Apple prices are the usual India list prices. Google often runs ₹35–50 first-month offers.
Check the live prices before using them in marketing.

**On S3, a viable PAYG price (₹2.2–2.9/GB at break-even) is above what Google charges per GB of
capacity.** Showing a per-GB price invites exactly that comparison, and we lose it.

## 3. The three models

### Fixed plan

| Margin when the plan is full (S3 today) | 40 GB ₹60 | Plus 50 GB ₹59 |
|---|---|---|
| Typical full user | −31 % | −66 % |
| User at 15 GB | +60 % | +60 % |
| Average payer (mix: 50 % ~15 GB, 35 % ~30 GB, 15 % full) | ₹3.6/month (8 %) | ₹1.4/month (3 %) |

- Fixed plans work through **breakage**: most payers use much less than they pay for.
- **40 GB ₹60 vs 50 GB ₹59:** the 40 GB plan gives the user 20 % less for ₹1 more. It earns us about
  ₹2 more per payer a month. That isn't worth changing terms, test mandates and copy.
- **Max 200 GB at ₹149 loses 164 % when full on S3. Don't sell it** until costs come down.

### Pay-as-you-go (per GB per month)

Modelled at ₹3/GB above the free 10 GB, with 50 % more people paying because the entry price is
lower.
- **Revenue per payer falls** from ~₹46 to ~₹42.
- **PAYG keeps a margin only above about ₹4.3/GB.** At that price a 100 GB user pays ₹430 a month,
  against ₹130 at Google.
- **It can't run in the Play app.** Play Billing has fixed-price subscriptions and one-time products,
  but no metered usage billing. Lens is Android-first and Play is the main channel, so PAYG would
  only work for website-APK and web users.
- **Razorpay can technically do it:**
  - Subscriptions can add an amount to the next invoice (add-ons; check in test mode).
  - RBI rules make each mandate carry a **maximum amount set up front**.
  - The user gets a **notice 24 h before each debit**.
  - Debits above ₹15,000 need extra confirmation.
  - UPI mandates usually have a ₹5,000 default cap.
  - Every variable bill also needs its own GST invoice.
- **It's harder to run:** usage metering per day, a month-end bill, disputes ("why ₹73?"), failed
  small debits, and a refund flow.
- **Trust:** a photo backup is something people want to forget about. A bill that changes every
  month makes them think about their photos as a cost every month. Usage-based pricing helps with
  retention only for products that people grow into by choice.
- **Its one real strength:** revenue follows each user's growing library. Fixed plans lose that, and
  have to handle it with plan sizes, add-on packs and price reviews.

### Hybrid

- **Option A, base plan plus metered usage above it:** same Play problem as PAYG for the metered
  part.
- **Option B, base plan plus fixed add-on packs** (for example +50 GB): works on Play (a second
  subscription) and on Razorpay. To break even at full use on S3, a pack must cost **at least ₹2/GB,
  so +50 GB for ₹99 or more.** Plus with a pack would then be 100 GB for ₹158, against Google's
  ₹130, so it's for loyal users only.
- **Prepaid credits or automatic top-ups for storage:** a bad fit. Storage is recurring, so credits
  run out every month and raise "what happens to my photos?" Credits do fit **one-off actions**:
  - Move to Drive above 10 GB (₹15/GB, already built, quoted before paying)
  - large exports
  - future prints or AI jobs

## 4. Projections

Assumptions (they need validation — V1–V3 in `business-model-and-roadmap.md`):
- 15 % of active users are in the welcome period.
- Free users average 4 GB.
- Platform costs ₹0.8 per user, plus fixed costs of ₹3k / ₹15k / ₹1.2L / ₹9L a month at
  1k / 10k / 100k / 1M users.
- 60 % of payers pay through Play.

### 3 % of users paying (PAYG gets 4.5 %); monthly profit

| Scenario | 1k | 10k | 100k | 1M |
|---|---|---|---|---|
| A. 40 GB ₹60, S3 today | −₹11.8k | −₹1.12L | −₹11.8L | −₹1.16 Cr |
| B. PAYG ₹3/GB, S3 today | −₹11.8k | −₹1.13L | −₹11.9L | −₹1.17 Cr |
| C. Plus ₹59 + packs, S3 today | −₹11.8k | −₹1.13L | −₹11.9L | −₹1.17 Cr |
| D. C + originals to Glacier IR + archive inactive free accounts | −₹8.6k | −₹81k | −₹8.6L | −₹84L |
| E. D on Backblaze B2 / similar, free delivery | −₹7.1k | −₹56k | −₹5.3L | −₹50L |

At 6 % paying the picture is about the same (D at 100k: −₹8.3L).

**The paid model changes the result by under 2 %. Free users and the welcome period are 62 % of all
cost.**

Cost split at 100k users today, ₹13.4L a month in total:

| Who | Monthly cost |
|---|---|
| Free users | ₹4.8L |
| Welcome period | ₹3.5L |
| Platform | ₹2.0L |
| Delivery (mostly free users viewing) | ₹1.6L |
| **Paying users** | **₹1.2L** |

### What gets close to break-even (100k users, monthly)

| Change | Profit |
|---|---|
| Today (10 GB free, 40 GB × 3-month welcome, S3, 3 %) | −₹11.9L |
| + Glacier IR originals + inactive-account archive | −₹8.6L |
| + free 5 GB (new sign-ups) + welcome 20 GB for 1 month, 5 % paying | −₹5.6L |
| + ads for free users, ₹1.5/user/month (never in the camera) | −₹4.1L |
| Same on B2-like storage with free delivery | −₹1.2L |
| Same at 8 % paying | −₹0.4L (≈ break-even) |

A free user can only cost what paying users can fund:

| Paying share | Affordable cost per free user / month (₹20 margin per payer) |
|---|---|
| 3 % | ₹0.6 |
| 5 % | ₹1.0 |
| 8 % | ₹1.7 |

Today a free user costs ₹8.

## 5. Effect on trust, conversion, retention, referrals and competition

| | Fixed plans | PAYG | Base + packs |
|---|---|---|---|
| Trust | Highest: one known price | Lowest: the bill changes, and people fear surprises | High if packs are opt-in and capped |
| Conversion | Medium: the ₹59 step | Higher entry (₹10–20 bills) but small amounts | Same as fixed |
| Retention | Good: set and forget | Every bill is a reminder to leave | Good |
| Referrals (+10 GB) | Clear value ("worth ₹12") | Muddy (free GB against metered GB) | Clear |
| Against Google Photos | ₹1.18/GB beats Google at the same size | Loses on visible ₹/GB | Fine up to 50 GB, weaker above |
| Works on Play | Yes | **No** (metered) | Yes |
| Effort to build and run | Built | Metering, invoices, disputes, caps | Small (one more product) |

## 6. Recommendation

1. **Keep fixed plans.** Lens Plus stays 50 GB for ₹59 a month or ₹499 a year. Don't move to 40 GB
   for ₹60, and don't sell Max 200 GB at ₹149.
2. **No per-GB-month PAYG, now or after 40 GB.**
   - It doesn't work in the Play app.
   - On S3, its viable price is above Google's per-GB price.
   - It weakens trust in a backup product.
   - Revisit only if the storage cost falls to about ₹0.9/GB (section 7, item 4) and the web channel
     grows.
3. **Heavy users** get two options:
   - back up to **their own Drive or Dropbox** (unlimited, already built, we keep previews only);
   - **Move to Drive.**

   Later, a **+50 GB pack at ₹99 or more**, opt-in only, once costs come down.
4. **Pay-per-use only for one-off actions:** an exact quote, then consent, then the charge. Move to
   Drive already works this way.
5. Any variable or pack charge must follow these rules:
   - explicit consent per product;
   - a monthly cap the user sets themselves (hard stop);
   - alerts at 50 / 80 / 100 % of the cap;
   - the RBI 24-hour notice before each debit;
   - auto top-up off by default.

   On payment failure, only new uploads pause, with the current grace and notices. Viewing, sharing
   and downloading never stop. Data above the limit is only removed after 5 months with notices, as
   already built.

## 7. What fixes sustainability (decisions for the owner, biggest first)

1. **Inactive free accounts** (open item V4). After 6 months with no app open, move originals to Deep
   Archive (₹0.18/GB) and keep previews. Restore for free when the user comes back (~12 h). Notice
   first, and never delete.
2. **Welcome: 40 GB for 3 months costs ≈ ₹71 per sign-up.** Options:
   - 20 GB for 1 month;
   - 40 GB only for invited users, or after 20 backups.

   Treat it as acquisition spend with a budget.
3. **Store new originals in Glacier Instant Retrieval:** ₹0.44/GB from day one instead of ₹2.2 for
   the first month. The app shows previews, and reading an original costs ₹2.6/GB. Watch the
   90-day minimum on deletes. It's a small change (storage class on upload) and saves ~10–20 %.
4. **Look at cheaper storage for originals:**
   - Backblaze B2: ~$0.006/GB, free delivery through a CDN partner.
   - Cloudflare R2: $0.015/GB, no delivery fees.
   - Wasabi: $0.0068/GB, 90-day minimum.

   This is the only route to ~₹0.9/GB all-in. It needs a short test first: upload speed from India
   (no Mumbai region), CDN terms for video, DPDP Act, migration cost.
5. **Free tier size for new sign-ups:** 10 GB vs 5 GB. 10 GB beats nothing against Google's 15 GB
   (which is shared with Gmail), but costs ~₹6–8 per free user a month. Option: keep 10 GB when the
   user backs up to their own Drive, and give 5 GB of Lens storage otherwise.
6. **Ads for free users** (rewarded ad → storage, native ads in the gallery, never the camera):
   ~₹1–2 per free user a month. Plan in `project-lens-ota-ads`.
7. **Add the second copy** (cross-account Deep Archive, +₹0.18/GB). It's already in the numbers
   above. A backup product needs it for trust.

Before payments go live:
- Validate the conversion rate (V1/V3) and the average free-user storage from real data in the
  console.
- Re-run `research/pricing/`.
