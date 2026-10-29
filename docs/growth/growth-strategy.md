# Lens growth strategy (2026-10-29)

The second pass after `organic-growth-plan.md` (2026-10-21). That plan was mostly about growth
*features*, and most of them are built: share-link previews, links that share full quality by
default, double-sided referrals, the event QR kit, Play in-app review, comparison and trust pages,
our own analytics and retention notifications. This pass is about everything around the app:
audience, name, positioning, store presence, trust, channels, unit economics and the weekly routine.

## 1. Where we really are

| Fact (checked 2026-10-29) | What it means |
|---|---|
| Website: **10 visits in 30 days**, all "direct" (us), 1 Get Lens click | Nobody outside the team has found Lens yet. Distribution is the whole problem right now, not features. |
| App accounts: 1,035, almost all from Firebase Test Lab and e2e test runs | Real users are the owner and the testers. Zero organic users. |
| Play closed test **published today**; 0 of 12 testers opted in | Production (the public listing) is at least 14 days away, counted from when 12 testers have joined. |
| No social accounts, no community, no email list, no press, no backlinks | Nothing to launch *into*. |
| Search Console / Bing still not verified (needs a DNS TXT at Hostinger) | Google may not have indexed most of our 44 pages. |
| Play listing: only en-US; short description flagged "price or promotion"; screenshots from 2026-10-19; no promo video; no ratings | The store page is our most important page, and it's the weakest one. |

**The product is far ahead of its distribution.** Lens has more features than most apps at
launch (pro camera, backup, own-storage connectors, events, recaps, People, editor, web app).
What it lacks is an audience, a clear reason to choose it, and trust.

## 2. What we're missing or getting wrong

### 2.1 The name breaks word of mouth (biggest hidden risk)
"Lens" is Google Lens on every Android phone. When a guest says "get Lens", a friend searching
Play or Google finds Google Lens. Our own SEO competes with Google for its own product name. Every loop we built ends
with someone *searching for us*, and that search fails.
- **Cheap to fix now, expensive after launch.** The package name (`com.instagrowapp.lens`) stays
  as it is. Only the display name, icon label, website wording and listing change. After production,
  reviews, press and links will carry the old name.
- **Options:** (a) keep "Lens" and always say "Lens by InstaGrow" (weak: people drop the suffix),
  (b) a distinctive, searchable name (one or two syllables, available as a .com/.app,
  no trademark clash in Photography, works in English and Hindi).
- **Decision for the owner.** If you want (b), I'll run a naming shortlist (availability and
  Play search checks) this week, before production.

### 2.2 We lead with gigabytes, and we can't win on gigabytes
| | Free storage | Catch |
|---|---|---|
| JioAICloud | 50 GB free for Jio numbers; others get a 3-month trial | India-only; tied to a SIM |
| TeraBox | 1 TB free | Full-screen ads, 4 GB file cap, slow free speeds, privacy doubts |
| Google Photos | 15 GB shared with Gmail | Pre-installed everywhere |
| **Lens** | 40 GB for 3 months, then 10 GB | — |

Our listing and site open with "40 GB free… 10 GB free". Next to "1 TB free", that loses, and
it also costs us the most (§2.5). **Storage should be a feature, not the headline.** What only
Lens does:
1. **A camera that never fills your phone.** It backs up while you shoot, then frees the space
   on its own. Nobody else is the camera itself.
2. **Full quality when you share.** A link sends the original, not WhatsApp's compressed copy.
3. **Everyone's photos from your event in one QR.** Guests add photos from the browser without
   installing anything, and it's free.
4. **No ads, no data selling, no AI training on your photos,** and it works with your own
   Drive or Dropbox if you prefer.

**Proposed headline:** "The camera that never fills your phone." Subline: "Every photo backed
up in full quality as you shoot. Share originals, not WhatsApp copies."

### 2.3 We say too many things at once; pick a launch wedge
Ten features in a listing read as "another gallery app". Launch with **one story** and keep the
rest as depth.
- **Recommended wedge: events (weddings, birthdays, trips with friends, college fests).**
  - Every event puts Lens in front of 50–300 people at a moment when they care, and the guest
    flow needs no install. That's the only loop we have that's built in, not bolted on.
  - The category is real and global, and the existing players are paid or wedding-only (Melora
    charges €50–200 per event; Folded is wedding-only). "Free, original quality, and it works
    after the event" is a real difference.
  - Phone-full backup is what **keeps** people. Events are what **brings** them.
- Everything else (Night mode, PRO, RAW, People, recaps) is screenshot 4–8 material, not the pitch.

### 2.4 Trust: we're asking strangers for their most private files
A new, unknown app asking for the whole camera roll is the biggest conversion barrier, and the
store page today gives no reason to trust it.
- **One consistent identity everywhere.** Right now Razorpay says "Clashhub", Google Payments
  "AKSHAY DHADWAL", the card statement "LENS INSTAGROW", the site "Lens by InstaGrow" and the
  tester group "Clash Hub". Pick one company name (InstaGrowApp) and use it for the Play
  developer name, Razorpay, the invoice and email sender, and the site footer.
- **A "Lens promise" page and a store bullet:** download everything any time (free); if Lens
  ever shuts down, at least 90 days' notice and a one-tap export; originals never touched.
- **A real person behind it:** an About page with the founder's story and why Lens exists. Indie
  apps win trust through a face, not a logo.
- **Proof:** the first 20 honest Play reviews (testers), a "how your photos are stored" diagram,
  and later an independent review or press mention.

### 2.5 Growth will burn money unless the economics come first
From `docs/business/pricing-models-evaluation.md`: a sign-up costs about **₹71** in welcome
storage and a free user about **₹8 a month**, and free users plus the welcome are about 62% of
total cost. So **10,000 sign-ups ≈ ₹7 lakh** in welcome storage alone, before any revenue.
Success at growth without these fixes is the most likely way Lens fails.
- **Play Billing live at production** (built on `feat/play-billing`, setup in progress) so
  Plus can be bought from day one.
- **Decide the cost levers that are still open** (2026-10-26): inactive-account archive, a
  smaller or conditional welcome, Glacier Instant Retrieval for originals, a second provider.
- **Push heavy users to their own Drive** (unlimited, almost free for us). It's also a trust
  message ("your storage, your control").
- **Event guests:** check that guest uploads count against the host's storage, not ours, and
  cap free event size.

### 2.6 The store page is the real homepage
More than 90% of installs will come through Play search, Play browse or a Play link, so App
Store Optimisation (ASO) is worth more than the website.
- **Title** (30 characters): keep the keywords "Camera" and "Photo Backup", plus the new name if
  we change it.
- **Short description** (80 characters, no price or promo words, or Google won't feature the app):
  "Camera that backs up every photo in full quality and keeps your phone free."
- **Screenshots:** 1 = phone full → shoot freely, 2 = event QR, 3 = full quality vs WhatsApp,
  4 = Night/PRO, 5 = own Drive, 6 = privacy. Big captions; no personal photos or notifications
  in any frame.
- **A 30-second promo video** (YouTube): an event QR in action.
- **Localised listings** in the biggest Android markets with low-storage phones: Hindi,
  Indonesian, Portuguese (BR), Spanish (LatAm), Filipino, Vietnamese. We have no ad budget; Play
  search in those languages is a free audience. The app itself stays English for now (§4.3).
- **Ratings:** in-app review is built. The 12–20 testers are our first reviews, so ask them
  for honest ones.

### 2.7 No channels, no community, no launch plan
- **Owned:** an Instagram account (Lens is visual), YouTube Shorts, an X/LinkedIn
  build-in-public account, a WhatsApp channel for users. All under one handle.
- **Earned:** Product Hunt and Reddit (r/Android, r/androidapps, r/photography, r/weddingplanning,
  r/IndiaTech) at production launch; Indian tech YouTubers and writers (they cover
  "app that saves phone storage" stories); a press kit page.
- **Partners:** 5–10 wedding photographers, event planners and college fest teams use event
  albums free, with their name on the QR card. One planner = dozens of events a year.
- **Content that travels:** "phone full → still shooting", "WhatsApp vs original" side by side,
  "200 wedding photos in one QR in 10 seconds", Night mode vs the stock camera. Three short
  videos a week.

### 2.8 Measurement gaps
- Verify Search Console and Bing (owner: one DNS TXT at Hostinger) and submit the sitemap.
- Tag every link we post with a source (`?src=ig`, `?src=reddit`, `?src=planner-<name>`) so
  Lens Console shows which channel works. The beacon already records `src#`.
- Use the Play Console store-listing acquisition report: which search terms and countries
  turn into installs.
- **One weekly number:** active users who backed up at least once that week.

## 3. The plan

### Phase A: the closed test (now → production, ~3 weeks). Prepare the launch.
| # | What | Who |
|---|---|---|
| A1 | Get 12+ testers opted in **this week** (the 14 days start only then); the 7 weekend testers join on Saturday | Owner |
| A2 | **Name decision** (§2.1); if it changes, shortlist and checks first | Owner decides, Claude does the checks |
| A3 | New positioning in the listing, site homepage and in-app onboarding copy (§2.2, §2.3) | Claude |
| A4 | New short description, 6 screenshots, 30 s promo video, localised listings (§2.6) | Claude builds; owner approves the visuals |
| A5 | One brand identity everywhere, About page, "Lens promise" page (§2.4) | Owner (Razorpay, Play names) + Claude (pages) |
| A6 | Play Billing live and the cost-lever decisions made (§2.5) | Owner decides, Claude builds |
| A7 | Search Console + Bing (DNS TXT), source-tagged links (§2.8) | Owner (DNS), Claude |
| A8 | Social accounts under one handle, the first 9 posts drafted (build in public: "launching in 2 weeks") | Owner creates the accounts, Claude drafts |
| A9 | Testers → first community: a WhatsApp group, ask for feedback and honest reviews | Owner |
| A10 | Press kit page, Product Hunt page, Reddit and launch posts drafted | Claude |

### Phase B: launch week (production day ±7 days)
- The website download button and every `/r`, `/go` and `/s` link point to the Play listing.
- Product Hunt + Reddit + LinkedIn/X + WhatsApp, on separate days so each gets attention.
- Personally invite 20–30 people who have an event in the next month (weddings, birthdays, trips)
  to create an event album. Each event seeds dozens of guests.
- Watch every review and reply within 24 hours. Fix crashes the same day (OTA).

### Phase C: first 90 days (loops + channels)
- Partnerships pilot: 5–10 photographers, planners and fests.
- Content engine: 3 short videos a week; weekly build-in-public post.
- SEO: two problem pages a week (e.g. "TeraBox alternative without ads", "JioCloud vs Google
  Photos vs Lens", "collect wedding photos from guests free").
- Monthly review: drop channels that don't move the weekly number; double the ones that do.
- **Paid ads only after** week-4 retention ≥ 20% and Plus conversion is measured. Then a small
  Google App Campaign test (₹10–20k) to learn the cost per install against the value per user.

### Phase D: after product-market fit
iOS standalone (event hosts and guests on iPhone), Hindi and other app languages, the
affiliate program at scale (payouts are live once payments are), Lens Studio.

## 4. Targets (first guesses; recalibrate after 4 weeks of real data)
| Milestone | Target |
|---|---|
| Day 30 after production | 300 installs · 100 weekly backup users · 20 Play ratings ≥ 4.5★ · 10 events created |
| Day 90 | 3,000 installs · 1,000 weekly backup users · W4 retention ≥ 20% · first 30 paying Plus users |
| Health | Crash-free ≥ 99.5% · cost per active user known and falling |

## 5. Decisions the owner needs to make
1. **Name:** keep "Lens", or choose a distinctive name before production (§2.1).
2. **Launch wedge:** events first (recommended) or phone-full backup first (§2.3).
3. **Cost levers** from 2026-10-26, before any scaling (§2.5).
4. **Identity:** one company name across Play, Razorpay, the site and email (§2.4).
5. **Time:** who posts and replies on social, and how many hours a week. Growth needs a steady
   3–5 hours a week of owner time (posts, partner calls, replies). Claude can draft everything.

Sources for §2.2–2.3 (checked 2026-10-29): [jio.com JioAICloud](https://www.jio.com/jcms/apps/jioaicloud/),
[Logicity on TeraBox](https://logicity.in/en/blog/terabox-s-free-1tb-storage-has-hidden-costs-worth-knowing),
[Cloudwards TeraBox review](https://www.cloudwards.net/review/terabox/),
[Knipsmig wedding photo apps 2026](https://knipsmig.com/best/wedding-photo-apps),
[Melora](https://peerlist.io/v2matosevic/project/melora).
