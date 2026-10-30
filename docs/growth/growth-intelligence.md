# Growth intelligence: trends, search, behaviour → content → results (design, 2026-10-30)

Owner request §11: add Google Trends and Google Analytics 4 to the growth engine so the agent finds
what people are becoming interested in, where Lens can compete, drafts the right content through
reviewed PRs, and measures whether it brings real users. Builds on `growth-engine.md` (facts →
analyst → ledger) and `seo-agent.md` (MCP tools with permission levels, GitHub App).

## 1. What the APIs really offer (checked 2026-10-30)

| Source | Access | Limits / caveats | Cost |
|---|---|---|---|
| **Google Trends API (official)** | Alpha since July 2025, **application only**, still not generally available in Oct 2026 | Small group onboarded; 5 years of data; no published quota | Free (alpha) |
| pytrends (unofficial) | Scrapes trends.google.com | Archived April 2025, frequent 429 blocks, against Google's terms | — **rejected** |
| **DataForSEO** (Google Trends API + Google Ads keyword volumes + SERP + keyword difficulty) | API key, pay as you go | Trends ≈ $0.0027 per task (5 keywords, ≤45 min queue); volumes come from Google Ads data (real monthly searches, not relative) | $50 minimum deposit, no subscription; our use ≈ $1–3 a month |
| Google Ads Keyword Planner API | Needs an Ads account + developer token approval | Exact volumes only with active ad spend, otherwise ranges | Free, slow approval |
| **Search Console API** | Already connected | ~3 days behind; only queries we already appear for | Free |
| **GA4 Data API** | Service account as property Viewer | Token quotas (≈200k/day standard) far above our needs | Free |

**Trends ≠ demand.** Trends is relative interest (0–100, sampled). Every opportunity carries both:
the trend direction (Trends) and absolute demand (Ads volume, or our own Search Console impressions).

## 2. GA4 or our own analytics?

The site uses **our own cookie-free analytics** (`site/src/scripts/beacon.ts` → `WSTAT#` rows): no
cookie banner, nothing about the visitor, and it already lives next to the app and backend data.

| | GA4 | Our analytics, extended (recommended) |
|---|---|---|
| Consent | Cookies → banner needed in EU/UK (and DPDP in India); many visitors decline, so data gets thin | No cookies, no IDs: no banner, nothing lost |
| Full journey (search → page → install → backup → retention → paid) | Separate system; joining it to app users needs user IDs across tools | Joins directly: the landing page travels in the Play install referrer (`utm_campaign=<page>`) into `PROFILE.acquisition`, which already has activation, retention and revenue |
| Engagement, country, device, campaigns, landing pages | Yes | Adds them: engaged visit (≥10 s or 2 pages), time on page, scroll depth, landing page, country/device from CloudFront headers, utm medium/campaign |
| New vs returning | Yes (cookie) | Not without an ID (by design); approximated by "direct + 2+ pages" |
| Google Ads later | Needed for conversion import | Add GA4 then, in consent mode |
| Cost | Free | Free (~₹0 DynamoDB) |

**Recommendation:** extend our own analytics now (G1) and connect GA4 only when paid Google Ads start
(E7). The agent's tools work the same either way: if the owner prefers GA4 now, it's a property +
tag + consent banner + a `ga4_report` tool (half a day).

## 3. How the three sources combine

```
Trends (what's rising) ─┐
Ads volumes (how big)  ─┼─► OPPORTUNITY backlog ─► content BRIEF ─► draft PR ─► owner approves/merges
Search Console (where  ─┤    scored by code,          (agent)        (GitHub     ─► published
  we rank, CTR)         │    relevance by agent                       App)          │
Our analytics (what    ─┘                                                            ▼
  visitors do, installs, activation, retention per landing page) ◄──── measured weekly vs baseline
```

**Opportunity score** (computed, not invented): `relevance × (demand + trend momentum) × winnability`
- relevance 0–3: the agent must name the Lens feature that solves it (from `docs/growth/product-facts.md`, a list of true product facts); 0 = skip ("don't chase every trend")
- demand: Ads monthly volume (IN + worldwide) or Search Console impressions
- momentum: Trends 12-month slope and "rising" related queries; seasonality flagged (weddings peak Nov–Feb in India)
- winnability: keyword difficulty + whether we already have impressions/position < 30 + the page type the results favour
- action: improve existing page / new guide / landing page / FAQ + internal links / conversion fix / social post / experiment

## 4. Content brief (every recommended page)

Target keyword + intent, supporting keywords + questions, demand evidence (trend + volume, labelled),
audience and problem, page type + URL, title (≤60), meta description, H1/H2 outline, Lens features to
show (from product facts only), internal links (from/to), what ranks today (top results summary),
business value + priority, measurement (metric, baseline, check date).

**Quality rules** (in the agent's instructions and checked in CI): written for the reader's problem
first; no invented features, prices or numbers (product facts + cited data only); no keyword
stuffing; one page per intent (no near-duplicates; checked against existing titles); Hindi version
only when written properly, not machine-pasted.

## 5. Publishing (approval workflow)

Opportunity → brief (Console) → owner clicks **Draft it** → the agent writes the page in a fresh
checkout (tool `edit_file`, only `site/src/**`) → the Lambda (not the model) opens a PR on
`agent/<id>` through the GitHub App → CI: build, `seo-check` (titles, descriptions, canonical,
hreflang, links), content checks (length, duplicates, product-facts terms) → owner reviews and merges
→ the Website workflow publishes. The agent never merges, never pushes to `main`, never deploys.

## 6. Dashboard (Console → Growth)

Tabs: **Overview** (the weekly report) · **Opportunities** (ranked backlog with evidence) ·
**Content** (brief → draft PR → merged → measured, with PR links and status) · **Search** (queries,
pages, CTR, position, index state) · **Website journey** (landing page → engaged → Get Lens →
install → backup → retained, by channel and campaign) · **Results** (each shipped recommendation:
baseline vs now, kept/dropped).

## 7. Build order

| Step | What | Effort | Needs from owner |
|---|---|---|---|
| G1 | Our analytics: landing page, engaged visits, time, scroll, country/device, utm medium/campaign, Get Lens per landing page; Play link carries the page (launch day) | 1 day | — |
| G2 | Trends + volumes: weekly pull for a seed list (photo backup, phone storage full, share full-quality photos, wedding/event photo sharing, travel photos, Google Photos alternatives…) in IN + worldwide → `TREND#`/`KW#` rows; tools `trend_explore`, `keyword_volume`, `serp_top` | 1 day | DataForSEO account + $50 deposit (or wait for the free official alpha: apply now) |
| G3 | Opportunity backlog + briefs (`OPP#`, `BRIEF#`), product-facts file, Console tabs | 1–2 days | — |
| G4 | Phase C: GitHub App, `edit_file` in a draft mode, PR creation, content checks in CI | 1–2 days | Create the GitHub App (guided, 10 min) |
| G5 | Results loop: published pages watched automatically; Results tab | ½ day | — |

## 8. Owner decisions (2026-10-30)
- **Analytics: both.** Extend our own cookie-free analytics (the journey to app users) **and** add GA4
  (free; Data API quotas are far above our needs). GA4 loads only after consent where the law needs it
  (EU/EEA, UK, Switzerland: a small banner; elsewhere on by default with an opt-out link), using
  Consent Mode. The agent gets a `ga4_report` tool (GA4 Data API, service account as property Viewer).
- **Trends: free sources only, no paid API.**
  1. Apply for the official Google Trends API alpha (free; owner fills Google's form).
  2. **Bing Webmaster Tools keyword research API** (free with our own API key): real weekly search
     counts per keyword and country on Bing, i.e. absolute demand with history, so it also shows direction.
  3. **Google Trends "Trending now" RSS** (official public feed, per country): what is spiking today, filtered for relevance.
  4. **Wikipedia pageviews API** (free, official): daily views of topic articles (e.g. "Cloud storage", "Google Photos") as a long-term interest signal.
  5. Search Console (ours) for the queries we already appear in.
  Labelled in every brief as Bing demand vs Google relative interest; Google Trends itself joins when the alpha is approved.

## 9. Status (2026-10-30, branch `feat/growth-intelligence`)
- **GA4 live** on the website (PR #7, #8): `G-MR339VK2QB`, property 558351960; Consent Mode v2 (EU/EEA, UK, CH banner), loaded when the page is idle (Lighthouse budget), not on private pages; privacy policy updated. Owner settings: India time zone/INR, 14-month retention, URL redaction (code, token, ref, lens_ref, lens_aff, email). Key events: star `get_lens`, `play_store`, `apk_download`, `signin` in Admin → Events once they arrive.
- **G1 our analytics v2** (`site/src/scripts/beacon.ts`, `infra/lambda/api/web-events.ts`, tests `web-events.test.ts`): landing page, utm medium/campaign, country (CloudFront header, edge-trusted only), device type, engaged visits (2+ pages or 10 s), seconds visible, 75 % scroll, Get Lens clicks by landing page. Still no cookies or IDs (session storage per tab only). Console → Analytics: landing pages, page quality, countries, devices, campaigns.
- **G2 free demand sources** (`infra/lambda/console/growth-sources.ts`, tests `growth-sources.test.ts`): Bing keyword research (SSM `/lens/growth/bing-key`), Wikipedia pageviews, Google Trends "Trending now" RSS, GA4 Data API (growth-analyst@ as Viewer; APIs analyticsdata/analyticsadmin enabled). Weekly facts (area `demand`, `ga4`) for 12 seed keywords × IN/US and 8 Wikipedia topics; analyst tools `keyword_volume`, `related_keywords`, `topic_interest`, `trending_now`, `ga4_report` (level 1). Live check 2026-10-30: all sources answer; "photo backup" on Bing US 4,735 searches in 12 weeks vs 1,026 before.
- **G3 content opportunities** (`growth-report.ts` schema `opportunities`, `opportunityScore`, `productFeatures`; `growth.ts` `GROWTH / OPP#<slug>`, `PUT /growth/opportunities/<id>`): relevance 0–3 × demand × trend × winnability; full brief; validator rejects features not in `docs/growth/product-facts.md`, numbers not from facts or tools, titles > 60, bad URLs. Console → Growth → Content opportunities (Plan it / Not for us / Mark published). Owner decisions are kept across weeks.
- Google Trends API alpha: applied 2026-10-30 (project lens-5df67).
- **Next:** G4 = Phase C (GitHub App; "Plan it" → drafted PR), G5 = results loop.
