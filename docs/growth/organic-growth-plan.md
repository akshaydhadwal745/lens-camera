# Lens organic growth plan (2026-10-21)

Goal: people discover Lens, try it, love it, share it, and keep using it, without paid ads.
Everything below is tied to what Lens already is (inventory checked in the code on 2026-10-21) and
is measured in our own analytics (Lens Console → Analytics, `docs/design/analytics.md`).

## 1. Positioning: what we say, and to whom

**Who feels the pain most:** Android users whose phone is always full (64–128 GB phones), who shoot a
lot at **trips, weddings, festivals, college events and family occasions**, and who have hit Google
Photos' 15 GB limit or WhatsApp's compression. English-first and worldwide, with India as the
strongest early market (Hindi site, ₹ pricing later).

**The promise, in one line:** *Shoot everything. Lens backs it up in full quality and frees your phone.
100 GB free.*

**Three reasons to switch, in the user's words:**
1. "My phone is full": Lens backs up as you shoot, then frees space automatically.
2. "Google Photos is full or compresses": 100 GB free at original quality (Google gives 15 GB, shared with Gmail).
3. "WhatsApp ruins my photos": send full quality with a link, and collect a wedding's photos with one QR code.

**Gap today:** the site never names the alternatives people compare us with (Google Photos, iCloud,
WhatsApp), and its headline ("Every shot. Full quality. Forever.") describes the product, not the
problem. People search for their problem, not for our product.

## 2. Audit: what helps growth today, and what's missing

| Area | What we have | What's missing (impact) |
|---|---|---|
| **Distribution** | APK download with instructions for "Install unknown apps" and Play Protect | **No Play Store listing.** The unknown-apps warning loses most visitors. Every loop (share links, invites, events) ends at an install, so this is the cap on everything else. |
| **Event albums** (strongest loop) | QR or link; guests add photos from the web without the app; the owner is notified | Not on the wedding page or the home page. No printable QR card. Web guests can't add videos. The "get Lens to keep them" ending is weak. Nothing rewards the host for guests joining. |
| **Share links** | `/s/` page with "Get Lens", deferred deep link after install (Play referrer or clipboard) | WhatsApp and Instagram previews show a generic card, not the photo. The viewer's main **Share** button sends the bare file, so it gets compressed and carries no Lens link. No Hindi on `/s` and `/e`. |
| **Referrals** | +10 GB to the inviter, fraud checks, push and email when a friend joins | **One-sided: the friend gets nothing**, which is weak in an invite message. Only reachable from Settings, not at the moments that matter (storage 90% full, after backup, after a share). |
| **Recaps** | Trip films rendered in the cloud | Can't be shared as a 9:16 Reel or Status. No music. No optional "Made with Lens" end card. Users aren't told when a film is ready. |
| **App store / ratings** | Draft listing text and 5 screenshots | Play in-app review isn't used: our star prompt goes to our own form, so happy users never rate us on Play. No keyword plan. No Hindi listing. |
| **SEO** | 44 pages, FAQ and app structured data, hreflang, sitemap | No Search Console or Bing. No comparison or "how to" pages, which is where problem searches land. One OG image for the whole site. |
| **Website analytics** | None | We can't see which page or source turns visitors into installs. |
| **Onboarding / activation** | Camera opens immediately; silent guest account | The user never sees that the first photo is backed up. The sign-in prompt comes after 3 photos, with no strong reason given. The app is English only. |
| **Retention / re-engagement** | Notifications for shares, events, storage 90% and finished backups | Nothing pulls people back: no trip recap ready, no "on this day", no "you freed X GB". |
| **Community / social** | Contact form only | No social accounts, no WhatsApp channel or Telegram group, no press kit, no email list. |
| **Partnerships** | Affiliate program (50% of revenue, web) | Pays only when paid plans exist, so there's nothing to earn yet. No partner type suited to event albums (photographers, planners, college fests). |

## 3. Prioritised opportunities (impact × effort)

Impact = how many new active users it can bring. Effort = our build or operating time. ★ = do first.

| # | Opportunity | Impact | Effort | Why it fits Lens |
|---|---|---|---|---|
| 1 ★ | **Play Store launch + a 12+ tester community** (closed test → production) | Very high | Low (mostly your clicks, 14-day wait) | Unblocks every loop. The testers become our first community (#8). |
| 2 ★ | **Share links that sell themselves**: preview of the shared photo in WhatsApp; Share defaults to "full quality via link"; Hindi on `/s` and `/e` | Very high | Medium | Every share reaches people who don't have Lens. Full quality is a real benefit, not a trick. |
| 3 ★ | **Event album kit**: printable QR card or table tent, "Wedding photos in one QR" on Home and the wedding page, video upload for web guests, a host reward (+1 GB per 10 guests, capped) | Very high | Medium | One wedding = 50–300 guests seeing Lens with a real reason to install. Our strongest loop. |
| 4 ★ | **Double-sided referral at the right moments**: friend gets +10 GB too; offered at 90% storage, after the first full backup and after a share; WhatsApp-first wording | High | Low | "We both get 10 GB" converts far better than "help me get 10 GB". |
| 5 ★ | **Play in-app review**: 4–5 stars → Google's review prompt; 1–3 stars → our feedback form | High (store ranking) | Low (new APK) | Ratings decide ranking and install rate on Play. We already ask at good moments. |
| 6 | **Problem-first SEO**: Search Console + Bing; pages "Lens vs Google Photos", "Google Photos storage full: what to do", "Send full-quality photos on WhatsApp", "Collect wedding photos from guests with a QR code", "Phone storage full on Android"; one OG image per page | High (compounds) | Medium, ongoing | Those searches are the pain Lens fixes. |
| 7 | **Shareable recap films**: 9:16, music, optional small "Made with Lens" end card, "Your trip film is ready" notification | High | Medium | Trip films get posted. A tasteful end card on a beautiful film is free reach. |
| 8 | **Community**: Lens WhatsApp channel + a beta testers group; build in public on X and LinkedIn; changelog posts | Medium | Low, ongoing | Testers for the Play rule, feedback, first evangelists. |
| 9 | **Activation moments**: a "Backed up ✓" toast on the first photo, then "Freed 1.2 GB" moments; sign-in asked right after the first backup ("Keep these safe on any phone, 100 GB free") | High (retention) | Low | People stay when they feel the promise working. |
| 10 | **Re-engagement**: "On this day", "Your trip film is ready", a weekly "X GB freed this week" (opt-out, max 1 a week) | Medium–high | Medium | Brings people back for something they care about. |
| 11 | **Our own website analytics**: page views, sources, Get Lens clicks, installs from share, event and invite links | Enabler | Low | Without it we can't tell what works. Same privacy rules as the app. |
| 12 | **Partnerships pilot**: 5–10 wedding photographers or planners and 2–3 college fests use event albums for free, with their brand on the QR card | Medium | Medium (people time) | They put Lens in front of hundreds of guests per event. |
| 13 | **Short-form content engine**: 3 videos a week (Night mode vs the stock camera, "phone full → 0 GB used", "WhatsApp vs Lens quality", wedding QR in action) | Medium | Medium, ongoing | Lens is visual, and before/after demos travel. |
| 14 | **Hindi in the app** | Medium (India) | Medium | The site is Hindi already; the app isn't. |
| 15 | **Press kit + launch posts** (Product Hunt, r/Android and others, Indian tech press) | Medium, a spike | Low | Launch-day reach and backlinks for SEO. |

## 4. Roadmap

### Phase 0: before launch (now → Play production, ~2–3 weeks)
1. Play Console: create the app, signing, listing (ASO keywords: camera, photo backup, free cloud
   storage, full quality, wedding photo sharing), Data safety, closed test. **Recruit 20 testers** (not just
   12; some drop out) from friends, family and a WhatsApp group, which seeds the community (#8).
2. Search Console + Bing Webmaster, sitemap submitted.
3. Our own website analytics (#11), so launch traffic is measured from day one.
4. Share-link previews: the shared photo as the OG image, and "Full quality from {name} · Lens" as the title (#2).
5. Homepage: lead with the problem ("Phone full? Shoot everything. 100 GB free, full quality.") and add the
   wedding QR block (#3).
6. New APK: Play in-app review (#5) + Play listing link everywhere `PLAY_URL` is used.

### Phase 1: first month after launch (loops)
1. Double-sided referral at the three moments (#4).
2. Share defaults to a full-quality link (with "Send file" still one tap away); Hindi `/s` and `/e` (#2).
3. Event album kit: printable QR card (PDF), video upload for web guests, host reward, a better
   "keep these" ending for guests (#3).
4. Activation moments (#9).
5. SEO pages, two a week (#6). WhatsApp channel and weekly build-in-public posts (#8). Launch posts (#15).

### Phase 2: months 2–3 (depth and retention)
1. Shareable recap films (9:16, music, end card, ready notification) (#7).
2. Re-engagement notifications (#10).
3. Partnerships pilot with photographers and fests (#12). Content engine at 3 a week (#13).
4. Hindi in the app (#14).

## 5. KPIs (in Lens Console; targets are first guesses, to recalibrate after 4 weeks of data)

| Stage | KPI | Where | First target |
|---|---|---|---|
| Discover | Site visitors/week; Play listing visitors; organic search clicks | site analytics (#11), Play Console, Search Console | +20% week on week for the first 8 weeks |
| Convert | Play listing → install rate; site "Get Lens" → install | Play Console; site analytics | ≥ 30% listing conversion |
| Activate | % of installs with a backed-up photo within 24 h | Analytics → Funnel (step 2) | ≥ 60% |
| Activate | % signed in within 7 days | Funnel (step 3) | ≥ 35% |
| Share | % of active users who share in 30 days | Funnel (step 4), Feature use | ≥ 25% |
| Viral | **K-factor** = installs from invites + share links + events ÷ active users | attribution (`/r`, `lens_share`, `/e` joins) | ≥ 0.3 at first, then 0.5+ |
| Viral | Event album: guests per event; guests → installs | events + attribution | ≥ 25 guests per event; ≥ 10% install |
| Retain | Week-1 and week-4 retention | Analytics → Retention | W1 ≥ 40%, W4 ≥ 20% |
| Love | Play rating; share of 4–5★ in our prompt | Play Console; Feedback | ≥ 4.5★ |
| Health | Crash-free users | App errors (Sentry) | ≥ 99.5% |

**The one number to watch weekly:** active users who backed up at least once that week. It
captures discovery, activation and retention together.

## 6. Principles (so growth stays honest and cheap)
- Every loop gives the user something real: full quality, everyone's wedding photos, more storage.
  No dark patterns. No auto-posting. No contact-list scraping.
- Branding stays optional and tasteful (an end card on films, a small line on link pages), never a watermark forced on photos.
- At most 1 marketing notification a week, always opt-out. Event and share notifications only when something really happened.
- Measure before scaling. Each phase ends by checking the KPIs above and dropping what doesn't move them.
