# Lens business model, retention and growth roadmap (2026-10-21)

Owner's brief: fix growth gaps 1–6, change free storage and referrals, real messaging + SEO + ASO +
analytics, a retention system with notifications managed in the Lens Console, and a sustainable
business model. Decide from real costs, challenge assumptions. This document has the audit, the cost
model, the pricing evaluation, dependencies, and the roadmap, split into "build now" and "validate first".

## 1. What exists today (checked in code and AWS on 2026-10-21)

| Area | Today | Reuse |
|---|---|---|
| Storage limits | Guest 5 GB (per device), signed in 100 GB (`QUOTA_BYTES`, `quotaFor()` in `lib.ts`), bonus bytes added on top | Change the numbers and add an entitlement field; the quota checks stay |
| Referrals | Inviter +10 GB when the friend signs in on a new phone; friend +0; fraud checks; push + email | **Already matches your rule** (inviter +10 GB, friend gets the standard allowance). Add a cap and an activation condition |
| Push | FCM from the API (`push.ts`), per-category preferences (`notificationPrefs`), share/event/invite/storage-90% pushes, local "backup finished" | Base for lifecycle + campaign notifications |
| Analytics | Own: funnel, retention, feature use (Lens Console → Analytics) | KPIs for everything below; segments for targeting |
| Own storage | Google Drive, Dropbox, OneDrive, Box, S3, WebDAV connectors | **A near-free plan for us** (see §4) |
| Payments | None (affiliates assume future revenue) | Needs Google Play Billing |
| Storage classes | Media bucket: Intelligent-Tiering (originals), previews Standard | Cost model below |

AWS bill check: S3 shows 84 GB-month in September, but **Lens media is only 2.6 GB**. 49.75 GB is
`instagrow-assets` (another project) and 8.9 GB is old APKs and app updates in the website bucket
(→ add a lifecycle rule to drop old releases, ~$0.20/month saved). Route 53 $0.50 is the
onebyphantom.com zone (not Lens).

## 2. Unit cost per user (AWS list prices for Mumbai, from the AWS Price List API, 2026-10-21)

| Item | Price |
|---|---|
| S3 Intelligent-Tiering: frequent / infrequent (after 30 days) / archive instant (after 90 days) | $0.025 / $0.0138 / $0.005 per GB-month |
| S3 Standard (previews, thumbnails) | $0.025 per GB-month |
| CloudFront to viewers in India | $0.109 per GB (first 1 TB/month free, always) |
| Uploads to S3 | free (requests: $0.005 per 1,000) |
| Video processing (Fargate Spot, measured on our bill) | $0.0127 per vCPU-hour; only when a video is streamed |

**Blended storage cost.** A library filled evenly over a year: 1/12 is under 30 days old, 2/12 is
30–90 days, 9/12 is over 90 days (originals are rarely opened; the app shows previews), so
(1×0.025 + 2×0.0138 + 9×0.005) / 12 = **$0.008 per GB-month**. Adding previews, video streaming copies
and the per-object monitoring fee gives about **$0.012 per GB-month** (year 2 is cheaper still).

| User type (assumed mix) | Stored | Storage | Viewing traffic | Video processing | **Total per month** |
|---|---|---|---|---|---|
| Light (60%) | 3 GB | $0.04 | 0.2 GB = $0.02 | ~$0 | **$0.06 (₹5)** |
| Typical (30%) | 12 GB | $0.15 | 0.5 GB = $0.05 | $0.02 | **$0.22 (₹19)** |
| Heavy (10%) | 40 GB full | $0.50 | 3 GB = $0.33 | $0.15 | **$1.00 (₹88)** |
| **Average paying user** | 9.4 GB | | | | **≈ $0.20 (₹18)** |

₹88 = $1. Fixed costs (Lambda, database, email, Sentry, console) stay near the free tiers until
tens of thousands of users. The usage mix is an assumption; we'll replace it with real numbers from
Analytics (storage per user, percentiles) after launch.

## 3. Your pricing ideas against these costs

**What reaches us from a subscription.**
- India: prices on Play include GST (18%). Google Play keeps **15%** of subscriptions.
  - ₹30 → ₹25.42 after GST → **₹21.6 ($0.245)** to us.
  - Who files the GST depends on the Play tax setup in India; check this in Play Console → Payments.
- International: $0.99 → **$0.84** in the US, where tax is added on top. About **$0.70** in the EU, where VAT is included.

| Plan | We receive | Cost of an average user | Cost of a heavy (full) user | Verdict |
|---|---|---|---|---|
| ₹30/month, 40 GB (India) | ₹21.6 | ₹18 | ₹88 | **Not sustainable.** Margin is ~₹4 on average, each heavy user loses ~₹66 a month, and margin shrinks as libraries grow. Nothing is left to pay for free users. |
| $1/month, 40 GB (international) | $0.70–0.84 | $0.20 | $1.00 | Fine on average; heavy users are about break-even |
| +50 GB for ₹120/month | ₹86 | — | ~₹55–75 if full and streamed | OK but thin for heavy streamers |

**Recommended instead (to test, see §6):**
- **India:** Lens Plus 50 GB **₹59/month or ₹499/year**, and Lens Max 200 GB **₹149/month or ₹1,299/year**.
  - ₹59 gives us ≈ ₹42.5 a month, which covers a full heavy user over time and leaves room for free users.
  - It's still below the usual Indian alternatives: Google One's 100 GB is ₹130/month, and iCloud's 50 GB is ₹75. Verify current prices before launch.
- **International:** $1.49/month for 50 GB and $3.99 for 200 GB, with Play's regional pricing for other countries.
- **Yearly plans first** (two months free): fewer renewals that fail, less churn, and cash up front.

## 4. Trial vs permanent free tier

| | 3-month 40 GB trial, then paid | Permanent free tier |
|---|---|---|
| Growth loops (events, share links, invites) | Weak: guests and friends hit a paywall within 3 months, so they don't invite or host | **Strong: free users keep hosting events, sharing and inviting** |
| Conversion | A no-card trial typically converts 2–5% (industry ranges; ours unknown) | 2–5% over a longer time, but the people who convert are those who really use it |
| Trust and reviews | Risky: "they're holding my photos hostage" 1★ reviews when the trial ends | Safer |
| Cost risk | Users fill 40 GB and leave: we keep paying for their data | Capped by the free limit |
| Fit with Google Photos (15 GB free) | Looks worse | "10 GB just for photos, full quality" is competitive |

**Recommendation: both, in this order.**
1. **Free forever: 10 GB, full quality**, plus referral bonuses.
2. **Welcome: 40 GB for the first 3 months, no card.** Lets people try the real thing, which is your trial idea.
3. **Free forever and unlimited when backups go to your own Google Drive, Dropbox, OneDrive and so on.**
   - We store only previews for these users, about $0.01 a month each.
   - It's a strong trust and SEO story ("Lens never holds your photos hostage"). We already have six connectors.
4. **At the end of the welcome period:**
   - **Nothing is deleted, and everything stays viewable and downloadable.**
   - New backups to Lens pause above 10 GB, with a clear choice: subscribe, invite friends, or back up to your own storage.
   - New photos stay on the phone until then.
   - Warnings go out 14, 3 and 1 days before, in the app, by push and by email.
5. **Over the limit and inactive for 12 months:** decide later (§6). Options:
   - keep the data (archive tier, 40 GB ≈ $0.20/month per user);
   - move it to slow storage restored on request (≈ $0.08/month);
   - delete after 24 months, after repeated notices, like Google's inactive-account policy.

   The policy has to say exactly which one we choose.

**Referrals under this model:**
- The inviter gets **+10 GB per friend**, permanently, up to +100 GB. This is your rule plus a cap.
- It counts once the friend signs in **and backs up at least 20 photos**, which stops fake accounts.
- The friend gets the standard welcome (40 GB for 3 months) plus **one extra month of welcome**. That's a cheap incentive for the friend, so the invite isn't a favour.
- Cost: bonus storage only costs money while it's used. 10 GB filled ≈ $0.12/month.

## 5. Dependencies

1. **Play listing live** comes before:
   - Play Billing (subscriptions);
   - Play in-app review;
   - store links in share and invite flows (`PLAY_URL`, already wired).
2. **Gallery auto-backup needs a Play policy declaration.** It uses Android's "photos and videos" permission (`READ_MEDIA_IMAGES/VIDEO`). Play allows it for backup apps, but only with a declaration form.
3. **Billing needs:**
   - a payments profile in Play Console;
   - the Play Billing library in the app (new APK);
   - server checks (Google Play Developer API service account, and real-time notifications through Google Cloud Pub/Sub to our API);
   - an entitlement on the profile that feeds `quotaFor()`.
4. **The welcome period and storage limits need the entitlement system** (also used by referral bonuses and plans) and the end-of-welcome notices. That depends on **notifications** and **email**.
5. **Website messaging depends on the final free and paid numbers.** Copy written now must not promise "100 GB free".
6. **Notification campaigns need preferences and frequency limits first.** Without them, a campaign could spam people.

## 6. Roadmap

### Build now (confident, no market risk)
| # | What | Reuses | Effort | Success metric |
|---|---|---|---|---|
| N1 | **Notifications platform:** categories + preferences, a weekly marketing limit, quiet hours, opt-out, open tracking | `push.ts`, `notificationPrefs`, analytics | 2 d | opt-out < 5% per send; open rate ≥ 8% |
| N2 | **Lifecycle notifications:** weekly "freed X GB / backed up N", storage low (phone and Lens), trip or event recap ready, "on this day", shared album activity (exists), referral at the right moments | recaps, media dates, events | 3 d | Week-4 retention +5 pts |
| N3 | **Console → Notifications:** compose, preview, choose an audience (signed in or guest, active or inactive N days, storage %, app version, region, has shared…), schedule or send now, frequency limit, sent / delivered / opened / opted out | Console roles + audit, analytics segments | 2 d | All campaigns measured |
| G1 | **Share links that preview the photo** (only "anyone with the link" links), share defaults to a full-quality link, Hindi `/s` `/e` | `links.ts`, `/s` page | 1.5 d | link view → install ≥ 5% |
| G2 | **Event album kit:** printable QR card, video upload for web guests, host reward, a better ending for guests, event albums on Home and the wedding page | events.ts, `/e` | 2 d | ≥ 10% of guests install |
| G3 | **Referral changes:** cap, activation (20 photos), friend's extra welcome month, offers at 90% storage, after a full backup and after a share | referrals.ts | 1 d | K-factor ≥ 0.3 |
| W1 | **Website:** problem-first messaging; pages "Lens vs Google Photos", "Google Photos storage full", "Send full-quality photos on WhatsApp", "Collect wedding photos with a QR code", "Phone storage full on Android"; trust page (who we are, where photos live, encryption, deletion, own-storage option); per-page OG images | Astro site | 3 d | organic clicks +20% week on week |
| W2 | **Our own website analytics** (page views, sources, Get Lens clicks) + Google Search Console and Bing (you add one DNS TXT record) | analytics backend | 1 d | measured from launch |
| A1 | **One new APK** with: gallery auto-backup (opt-in at first launch) + quick-settings tile + home-screen widget + Play in-app review + Play Billing library (off until §6 is decided) | store/uploader, review prompt | 4 d | % of active users backing up ≥ 1/week: +15 pts; rating ≥ 4.5 |
| A2 | **ASO:** listing text built on the real problems, screenshots telling the story, Hindi listing | `docs/launch/play-store.md` | 0.5 d | listing → install ≥ 30% |

### Validate first (needs market research, financial modelling or real users)
| # | Question | How we'll answer it | When |
|---|---|---|---|
| V1 | Price: ₹59 vs ₹49 vs ₹30; monthly vs yearly | Price test on the pricing page and in an in-app survey ("would you pay…"); then Play's per-country pricing experiments | Before billing launch |
| V2 | Real storage per user and the heavy-user share | Analytics: storage percentiles by account age | 4–6 weeks after launch |
| V3 | Welcome length (3 months vs 1 month) and free tier size (10 vs 15 GB) | Compare conversion and retention between launch cohorts | 2–3 months |
| V4 | Over-limit policy after 12 months inactive | Your decision + a legal check of the privacy policy and terms | Before the first welcome period ends |
| V5 | GST and Play tax handling in India | Play Console payments profile + a CA | Before billing launch |
| V6 | Willingness to pay for Lens Max (200 GB) and family sharing | In-app survey + feedback "what's missing" | Month 2 |

## 7. Success metrics (Lens Console)
- **North star:** active users who backed up at least once in the week.
- Activation: ≥ 60% back up within 24 h; ≥ 35% signed in within 7 days.
- Retention: week 1 ≥ 40%, week 4 ≥ 20%.
- Viral: K-factor ≥ 0.3, event guests → installs ≥ 10%, share link views → installs ≥ 5%.
- Money (after billing): free → paid ≥ 3% at 90 days; storage + traffic cost ≤ 35% of revenue; heavy users (top 10%) not loss-making.
- Trust: Play ≥ 4.5★, refund rate < 2%, zero data-loss incidents.
