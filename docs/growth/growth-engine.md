# Lens growth engine: measurement, AI analyst, experiments, partnerships (2026-10-29)

Companion to `growth-strategy.md` (positioning, name, launch plan). This doc covers the system that
tells us what works: data → analyst → experiments → scale. Everything in §1 was **checked on
2026-10-29**. Numbers elsewhere are labelled as targets or estimates.

## 1. Phase 1 audit: verified baseline

### 1.1 Search (Google Search Console, set up today)
- Property `https://lens.instagrowapp.com/` verified through the Site Verification API (file
  `site/public/google19f0026184b2bd3f.html`). Owners: service account
  `growth-analyst@lens-5df67.iam.gserviceaccount.com` (for API reads) and akshaydhadwal2@gmail.com.
- Sitemap `sitemap-index.xml` submitted (64 URLs, EN + HI).
- **Indexed: 0 of 64.** 34 "URL is unknown to Google" (including the homepage), 30
  "Discovered – currently not indexed". **Search impressions in the last 90 days: 0.**
- Technical check of all 64 pages: all return 200, no noindex, canonicals correct, robots.txt
  correct, hreflang present. Small fixes: 47 titles over 60 characters (Google cuts them), 19
  descriptions outside 70–160 characters, 4 thin pages (contact, use-cases).
- **Diagnosis:** not a technical block. It's a new domain with no inbound links, so Google
  has no reason to crawl it. Fix: links from places Google already crawls (the Play listing,
  the public GitHub repo, social profiles, Product Hunt, directories, partner sites) plus
  manual "Request indexing" in Search Console for the top 10 pages.

### 1.2 Website (our own beacon → `WSTAT#` rows → Lens Console)
- Last 30 days: 10 visits, all `direct`, 11 views of `/s/` share pages, 1 Get Lens click,
  1 APK download. Effectively only us.
- Records page views, source (`utm_source` or the referring host) and clicks, **as daily
  totals only**, so a visit can't be followed to an install.

### 1.3 App and backend (`ACT#` rows, PROFILE, server counters → Console Analytics)
- Funnel (install → first backup → sign-in → share → came back 7+ days later), DAU/WAU/MAU,
  weekly cohorts, feature use and breakdowns exist and exclude test accounts.
- 1,035 accounts in the table, nearly all from Test Lab and e2e runs. Real users: the owner
  and the testers.
- Referral and affiliate attribution works end to end (`/r`, `/go` → Play referrer
  `lens_ref=` → write-once `PROFILE.attribution`).

### 1.4 Money
- Razorpay (website and APK) records purchases and feeds affiliate commissions. Play Billing is
  built on `feat/play-billing` and being set up.
- AWS bill for October: **$0.00** (free tier). Cost per user can't come from the bill yet, so it
  comes from the unit-cost model in `docs/business/pricing-models-evaluation.md` × bytes stored
  and delivered per account.

### 1.5 The journey: what we can and can't measure today
| Step | Measured? | Gap |
|---|---|---|
| Search impressions, clicks, rank | ✅ since today (Search Console API) | No history; indexing is zero |
| Social and campaign visits | ⚠️ counts per `utm_source` | No social accounts; no tagging convention |
| Website → install | ❌ | The website's Play button doesn't pass a source; the APK has no source |
| Play listing views → install | ❌ | Play Console reports need an API invite (§1.6) |
| **Install → which channel** | ❌ **biggest gap** | The app reads the Play install referrer but **keeps it only for referral codes**; `utm_source`/`utm_campaign` (organic Play, website, Instagram, partner) are discarded |
| Install → first backup → sign-in → share | ✅ | — |
| D1 / D7 / D30 retention | ⚠️ weekly cohorts only | Add daily-cohort D1/D7/D30 |
| Referral invites → signups → K-factor | ⚠️ parts | Invites sent and share-link → install aren't one ratio yet |
| Free → paid, revenue | ⚠️ Razorpay only | Play Billing; revenue per channel needs the source on the profile |
| Storage and bandwidth cost per user / channel | ❌ | Bytes are per account, but nothing turns them into ₹ per cohort |
| Partnerships (leads → events → users) | ❌ | No CRM; partner links can use `/go` codes |

### 1.6 Access still needed (exactly)
| Access | Why | Who / how |
|---|---|---|
| Play Console: invite `growth-analyst@lens-5df67.iam.gserviceaccount.com` with **View app information and download bulk reports (read-only)** only | Installs, uninstalls, store-listing visitors and conversion, search terms, ratings (bulk reports in Google Cloud Storage) and vitals (Reporting API) | Owner, 2 min, same screen as the billing invite |
| Search Console UI | You can see it now under akshaydhadwal2@gmail.com. Please click **Request indexing** for the homepage, /features/, /compare/google-photos/, /download/ and the wedding/event page | Owner, 5 min |
| Social accounts (Instagram Business + Facebook Page, YouTube) | Post, and later read reach data through their APIs | Owner creates them under one handle (name decision first) |
| LLM API key (§2.3) | The analyst's writing step | Owner approves the provider and a monthly cap |
| SSM write for the analyst key | The scheduled analyst reads Search Console | Owner says OK (same rule as before) |

## 2. Phase 2: the AI growth analyst

### 2.1 Principle: numbers are computed, never generated
An LLM that "analyses data" will make numbers up. So the analyst has two layers:
1. **Facts engine (deterministic code):** pulls every source, computes metrics, week-over-week
   deltas, anomalies (a robust z-score on daily series), keyword movers, high-impression/low-CTR
   pages, funnel and cohort tables. Each fact gets an ID (`F-gsc-q-12`). Stored as a weekly snapshot.
2. **Writer (LLM):** gets only the facts JSON plus the open experiments, and writes the
   report and recommendations, each citing fact IDs. A **validator** rejects any number in
   the text that isn't in a cited fact, and any recommendation without a hypothesis, expected
   impact, effort, metric and stop rule. Reports that fail are regenerated or flagged.

### 2.2 Sources and cadence
| Source | How | Cadence |
|---|---|---|
| Search Console | API (queries, pages, countries, devices; URL inspection for top pages) | daily pull, kept 16+ months (Google keeps 16) |
| Website | `WSTAT#` rows | daily |
| App + backend | Console analytics functions (funnel, cohorts, features), referrals, events, payments | daily |
| Play Console | bulk reports (GCS) + Reporting API | daily, once the invite is done |
| Costs | unit-cost model × bytes per account; Cost Explorer monthly (each call costs $0.01) | weekly |
| Experiments | `EXP#` rows: hypothesis, start, metric, baseline, status | on change |
| Social, ads | API once the accounts exist | later |

### 2.3 Model and cost
- The writer runs **once a week** on a few thousand facts, so token use is small. I'll compare
  current prices for Ollama Cloud, Claude Haiku/Sonnet and Gemini Flash against a
  side-by-side quality test on the same facts, and recommend one. Expected cost: a few dollars a month,
  with a hard monthly cap.
- The facts engine runs as a scheduled Lambda in our AWS (reuses the Console's analytics code),
  so the data never leaves our account except as aggregated facts sent to the model. No user
  emails or IDs go to the model.

### 2.4 What it produces
- **Weekly growth report** (Console page + email): the one number (weekly backup users), the funnel, 3–5
  findings with evidence, keyword movers, CTR fixes (current title → proposed title), anomalies,
  experiment results (baseline vs now, verdict), and the top 5 next experiments ranked by
  expected impact ÷ effort.
- **Recommendation ledger:** every recommendation has an ID and a status (proposed →
  approved → shipped → measured → kept/dropped), so the analyst checks whether past advice
  worked.
- **Guardrails:** read-only. Anything that changes production, public content, ad spend,
  user data or prices is a proposal for the owner. Safe, reversible automation (e.g. drafting
  a title change as a PR) only after a few weeks of proven reports.

### 2.5 Dashboard
Extend the existing **Lens Console → Insights** instead of building a new tool: a **Growth** tab
with search (impressions, clicks, CTR, position, indexed pages), website → install, the funnel by
channel, D1/D7/D30, K-factor, paid conversion, revenue, cost per active user and gross margin,
partnerships, and the weekly report.

## 3. Missing foundations to build first (Phase 1 work, small)
| # | What | Impact | Effort | Risk |
|---|---|---|---|---|
| M1 | **Keep the install source:** store the first-touch `utm_source/medium/campaign` from the Play referrer (organic Play shows as `google-play/organic`) on `PROFILE.acquisition`; website buttons pass `utm_source=site&utm_campaign=<page>` in the Play link | Unlocks channel → activation → retention → revenue | ~½ day server + app (new APK) | Low; no personal data |
| M2 | D1/D7/D30 retention by daily cohort and by channel in Console | Real retention numbers | ~½ day | None |
| M3 | Link tagging convention + a tiny link builder in the Console (`/go/<code>` for partners, `?src=` for social) | Every post and partner is measurable | ~2 h | None |
| M4 | Cost per account: bytes stored × ₹/GB + delivered × ₹/GB → cost per cohort/channel | Unit economics per channel | ~½ day | Estimates until the bill is non-zero; labelled as such |
| M5 | Search Console daily pull + facts snapshot (the analyst's first half) | History starts now | ~1 day | None |
| M6 | SEO fixes: shorten 47 titles, fix 19 descriptions, thicken 4 pages; links from the GitHub README, Play listing and social bios | Indexing and CTR | ~2 h + owner clicks | None |

### Status (2026-10-29, branch `feat/growth-foundations`)
- **M1 built:** `PROFILE.acquisition` from the install referrer (`attribution.ts parseAcquisition`, tests in `attribution.test.ts`); web sign-ups = `{source:'web'}`. Server-only: the app already sends the full referrer. Needs `cdk deploy`.
- **M2 + M4 built:** Console → Analytics → **By install channel** (installs, backed up, signed in, D1/D7/D30, paying, storage, estimated cost; `console/channels.ts`, tests).
- **M3:** convention decided, applied on launch day when the site's buttons switch from the APK to Play: `https://play.google.com/store/apps/details?id=com.instagrowapp.lens&referrer=utm_source%3Dsite%26utm_medium%3Dweb%26utm_campaign%3D<page-slug>`; social posts `?utm_source=<ig|yt|fb|x|reddit>&utm_campaign=<post>`; partners get `/go/<code>` links.
- **M5 built:** `search-console.ts` daily pull of the last 5 days (total, query, page, country, device) → `GSC#<day>` rows, run by daily maintenance; needs SSM `/lens/growth/service-account` (owner OK) + deploy.
- **M6 partly:** titles over 60 characters 47 → 23 (short brand suffix when long); the rest is rewritten with the new positioning (growth-strategy A3).

### Phase 2 status (2026-10-29): the growth analyst
- **Facts engine** `infra/lambda/console/growth-facts.ts`: Search Console (28 days vs the 28 before, query movers, high-impression/low-CTR pages, page-two queries), index coverage of every sitemap URL (URL Inspection API), website, funnel, D1/D7/D30, channels, money and growth loops. Every fact has an id. Tests: `growth-report.test.ts`.
- **Report** `growth-report.ts`: rule-based findings (work with no AI), the analyst's instructions and JSON schema, and a validator that rejects numbers not found in the cited facts (one retry, then stored with a "Check" flag).
- **Analyst** = the Claude Code CLI (`claude -p`, all tools off, `--json-schema`, model opus) in the **GrowthAnalyst** container Lambda (`infra/growth-image/Dockerfile`, CLI pinned 2.1.312), using the owner's subscription token from `claude setup-token` (SSM `/lens/growth/claude-token`). Internal report only: never user-facing. Weekly, Mondays 02:30 UTC, and **Run report now** in the Console.
- **Console → Insights → Growth** (`console/src/pages/growth.tsx`): summary, recommended experiments (hypothesis, impact, effort, cost, time, risk, metric, stop rule), findings with fact chips, review of earlier recommendations, the **recommendation ledger** (proposed → approved → shipped → measured → kept/dropped, audited), and the facts table. Permissions `growth` (owner, admin, finance, viewer) and `growth.write` (owner, admin). Monday email to owners.
- **First report (local run 2026-10-29)** found that Firebase Test Lab phones were counted as users (147 "installs", D1 0%). Fixed: `test-accounts.ts` treats guests from before the closed test (2026-10-29 09:00 UTC) that never signed in as test traffic, and from the next APK the app reports Test Lab phones itself (`isEmulator` checks the `firebase.test.lab` setting).

### Phase B (2026-10-29): the analyst gets tools (MCP)
- **Tool server** `infra/lambda/console/growth-mcp.ts`: an MCP server over stdio in the GrowthAnalyst container, the analyst's **only** tools (Claude Code built-in tools are off: `--tools "" --strict-mcp-config`). **No AWS credentials**: it gets a 1-hour Google token, a read-only copy of the website code (`site/src`, `site/scripts`, `site/astro.config.mjs`, `docs/growth` at the current `main` commit, fetched from the public repo) and a log file.
- **Levels enforced in the server**, not the prompt. Level 1 (always on): `search_analytics`, `compare_periods`, `inspect_url`, `list_sitemaps`, `audit_page` (live page + the source line of its title and description), `find_in_code`, `read_code`, `watch_page`. Level 2 (only when the owner ticks it in Console → Growth → Analyst tools): `submit_sitemap`. Level 3: `propose_change` only records a proposal; the owner approves or rejects it in the Console, and an approved one becomes a PR in Phase C. Per-report call limits, input validation, path checks (only our pages, only inside the code copy).
- **Audit:** every call, refused ones too, is stored as `GROWTH / ACT#…` (tool, level, input, ok, refused, error, report) and shown in Console → Growth → Tool activity. Proposals are `PROP#`, the watchlist is `WATCH#` (its pages become facts every week: impressions, clicks, index state).
- **Report:** new `seoInvestigations`, each labelled measured / likely cause / hypothesis, with code locations. The validator checks every code location against the code copy (file, line, quoted text) and allows numbers only from cited facts or this run's tool results. One retry if time allows (12-minute budget).
- **Tests:** `growth-mcp.test.ts` (levels, proposals, path escape, logging, location and number checks).
- **First tool run (local, 2026-10-29):** 32 tool calls, 0 validation problems. When its Search Console access failed (a network blip at container start, now retried 3×), it reported "can't see index status" instead of guessing.

## 4. Phase 3: first experiments (each against a baseline)
| Experiment | Hypothesis | Expected impact | Cost | Effort | Time to result | Metric / stop rule |
|---|---|---|---|---|---|---|
| E1 Get indexed | Links + Request indexing → pages indexed in 2–3 weeks | 0 → 30+ indexed pages | ₹0 | 2 h | 2–4 weeks | Indexed pages; stop: never (foundation) |
| E2 Play listing rewrite (positioning) | Problem-first copy converts listing visitors better | +30–50% listing conversion (estimate) | ₹0 | 1 day | 2 weeks after production | Store listing conversion (Play experiments A/B) |
| E3 Event seeding | 20 real events in month 1 bring guests who install | ≥10% of guests install | ₹0–5k (printed QR cards) | owner time | per event | Guests per event, guest → install, host retention |
| E4 Photographer/planner pilot | Pros bring events every week | 5 partners → 20+ events/month | ₹0 (free for them) | owner calls | 4–6 weeks | Events per partner, installs per event |
| E5 Short videos (3/week) | Before/after demos earn reach | 1k+ views/video by week 4 | ₹0 | 3 h/week | 4–8 weeks | Views → site visits (`src=ig`) → installs |
| E6 SEO problem pages (2/week) | Problem searches convert | First clicks by week 6 | ₹0 | 2 h/week | 2–3 months | Impressions/clicks per page |
| E7 Paid test (only after D30 ≥ 20%) | Google App Campaign at a known LTV | CPI below 30% of 12-month value | ₹10–20k cap | 2 h | 2 weeks | Cost per *activated* user and per D30-retained user; stop if 2× target |

## 5. Phase 4 and partnerships worth ₹1 crore+

Challenge to the assumption: **downloads won't make big partnerships; proof of a channel will.**
Large partners pay for one of three things: users they can't reach, engagement that keeps
*their* customers, or a product they'd otherwise build. Candidate categories, with what they'd
expect:

| Category | What Lens offers them | What they'd expect from us | Realistic? |
|---|---|---|---|
| **Phone makers' preloads** (Transsion's Tecno/Infinix/itel, Lava and others; low-storage phones) | "Phone never fills up" fixes their #1 complaint on 64 GB phones | 100k+ MAU, strong D30, low crash rate, cost per user proven; deals usually pay per activation | Medium-term (12–24 months); the biggest money, the hardest to get |
| **Telecoms** (Airtel, Vi; abroad Globe, Telkomsel…) | A storage perk for their plans (Jio already has its own cloud) | Billing integration, scale, support SLA | Medium-term |
| **Wedding/event platforms and ticketing** (WedMeGood, The Knot/Zola, Eventbrite, District…) | White-label event albums; guests get photos after the event | Proven events/month, guest participation rate, reliability on big events | **Most realistic first big deal** (6–12 months) |
| **Photography businesses** (studios, Pixieset-style tools) | Client delivery in full quality, guest uploads | B2B pricing, branding, admin | Early B2B revenue (3–6 months) |
| **Card, bank and app perks** (credit-card benefits, travel apps) | Lens Plus as a perk; trip albums | Brand trust, scale, redemption numbers | After brand recognition |
| **Colleges and corporates** (fests, conferences) | Event albums for thousands of people | Case studies, admin tools, data handling | Fast pilots; small money, big reach |

**Milestones toward a ₹1 crore partnership** (targets, not facts): 100+ events/month with
≥25 guests each; 50k+ MAU with D30 ≥ 25%; ≥4.5★ on Play; 2–3 public case studies; a measured cost
and margin per user. **B2B event albums are also the fastest route to revenue**, and they
fund consumer growth instead of competing with it.

## 6. Order of work
1. **This week:** M1–M6 + E1 (foundations), the owner's access items (§1.6).
2. **Next week:** analyst facts engine + Growth tab; model comparison and choice.
3. **From production launch:** E2–E6 weekly, with the analyst's report every Monday.
4. **Month 2–3:** E7 if retention qualifies; partner pipeline (B2B event albums pilot).
