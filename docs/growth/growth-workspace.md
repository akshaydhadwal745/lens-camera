# Growth Workspace: build checklist (started 2026-10-30)

The redesign of Console → Growth into a growth management workspace. Design and audit:
`growth-workspace-proposal.html`; clickable prototype: `growth-workspace.html`. This file is the
master checklist: an item is ticked only when it is built **and** verified (tests, build, live).

Defaults taken while the owner's answers are pending (all changeable in Growth settings):
north star = weekly backup users; targets = growth-strategy.md §4, day 30/90 counted from the Play
production date (unset → "starts at launch"); team = owner + growth agent; build order W1 → W4.

## Requirements → where they are met
| Owner's requirement | Item(s) |
|---|---|
| 1 Progress visible per area, computed not typed | W2.3, W2.4, W3.1 |
| 2 Action workspace: today, priorities, overdue, in progress, approvals, done, impact | W1.6, W1.7 |
| 2 Task fields: title, description, why/evidence, priority, impact, effort, owner, due, status, links, metric, result | W1.1 |
| 2 Assign, update, notes, ownership | W1.3, W1.4, W1.8 |
| 3 Organised by objectives/workstreams (SEO, content/distribution, acquisition/conversion, retention, partnerships, intelligence) | W3.1–W3.7, W2.5 |
| 4 AI → execution 10 steps | W1.5 (AI → tasks), W1.9 (drafts on tasks), W4.1 (results), W4.2 (text drafts) |
| 5 Roadmap: month focus, 30/60/90 targets, required work, done, on track, blockers | W2.1–W2.4 |
| 6 Team: roles, responsibilities, assignments, comments, history, approvals | W1.2, W1.3, W1.8, W4.3 |
| 7 Purpose: every section names its growth outcome | W3.1 (outcome header on every workstream), W4.4 |
| Audit: remove duplication, reuse integrations | W1.5 (5 lists → tasks), W2.5 (one brief) |
| New hire can start alone | W4.4 Start here |

## W1 Work (tasks, today, roles)
- [x] W1.1 Task model `GROWTH / TASK#<id>` (fields above, lifecycle Suggested → Ready → In progress → In review → Done → Measured, + Blocked, Won't do), ids from an atomic counter; `TASKLOG#<id>#<ts>` comments + history
- [x] W1.2 Roles `growth_lead` (manage) and `growth_contributor` (work on own/assigned tasks, comment); permissions `growth.manage`, `growth.contribute`; enforced in routes
- [x] W1.3 Routes: list/get/create/update tasks, comment, change status (with rules: Won't do needs a reason, Blocked needs a blocker, Done needs proof for non-PR tasks)
- [x] W1.4 Assignment + mention + review-request emails
- [x] W1.5 AI output becomes tasks (recommendations, opportunities, proposals → Suggested, deduped by key, workstream set by the agent); migration of existing REC#/PROP#/OPP# rows; analyst sees open tasks instead of the ledger
- [x] W1.6 Today screen: north star, my work, goal status, needs-decision, what changed, recent wins
- [x] W1.7 Tasks screen: board by status, list, Mine; filters (workstream, owner, goal); task drawer
- [x] W1.8 Task drawer: all fields editable by permission, evidence, metric, links, comments, history
- [x] W1.9 Agent drafts work on tasks (Ask agent to draft → PR → In review → merged → Done)
- [x] W1.10 North-star metric `app.weekly_backup_users` (+ weekly series) in analytics and facts
- [x] W1.11 Console navigation: Growth group (Today, Goals & roadmap, Tasks, Insights, workstreams, Growth settings)

## W2 Direction (goals, roadmap, insights)
- [x] W2.1 Goals `GOAL#`, key results bound to a metric (fact id) or manual value with history; milestones `MS#`; month focus `SETTINGS`
- [x] W2.2 Seed from growth-strategy.md: O1 launch, O2 day 30, O3 day 90, Health; milestones A/B/C; strategy tasks A1–A10 and owner decisions as tasks
- [x] W2.3 KR progress = (current − baseline)/(target − baseline); status vs period elapsed (on track / at risk / behind / not started)
- [x] W2.4 Milestone progress = verified-done tasks ÷ all, weighted by effort; blockers list
- [x] W2.5 Insights screen: weekly brief, triage of Suggested tasks (Accept/Dismiss with reason), anomalies, data-source health, history, facts, tool activity (admins)
- [x] W2.6 Live metrics for goals between reports (product/website facts from the analytics cache)

## W3 Workstreams
- [x] W3.1 Workstream template: outcome, outcome metrics, status counts (open/blocked/overdue/done), work, opportunities, results
- [x] W3.2 Search & content: demand table, pages needing attention (index state, titles, thin), opportunities, published content + results
- [x] W3.3 Social & distribution: post calendar `POST#` (idea → drafted → approved → published), tagged links, visits per post
- [x] W3.4 Website & Play Store: website funnel by landing page, listing tasks, ratings (when Play access), ASO checklist
- [x] W3.5 Activation & retention: funnel, D1/D7/D30, channels, Plus conversion
- [x] W3.6 Referrals & events: invites, event albums, guests, share links, affiliates
- [x] W3.7 Partnerships: pipeline `PARTNER#` (lead → contacted → meeting → pilot → live → won/lost), next step/date, owner, tagged link, visits per partner

## W4 Results, agent drafts, team
- [x] W4.1 Results loop: at a task's check date, current metric vs baseline/target → verdict (worked / no change / worse / too early) → Measured; PR merge → Done automatically
- [x] W4.2 Agent text drafts: social posts, Play listing text, partner outreach (no PR; stored on the task/post for approval)
- [x] W4.3 Monday digest per person (their open, overdue, due this week, waiting for their review)
- [x] W4.4 Start here page: mission, north star, strategy, how the workspace works, your role
- [x] W4.5 Growth settings: workstream owners (auto-assign), launch date, north star, month focus, agent permissions, data sources, product facts
- [x] W4.6 Docs (growth-engine.md, README status), tests, e2e, deploy, owner walkthrough

## Status (2026-10-30)
Built and verified locally: infra unit tests 89/89 (growth-workspace.test.ts: priority, lifecycle rules,
mentions, KR/goal/milestone progress, AI → tasks, partners/posts, results verdict, digest), typecheck,
Console build, every screen rendered in headless Chrome against a mock API with this week's real metrics
(no runtime errors). **Live since 2026-10-30** (LensConsole deploys 06:55, 07:08 and the Console files after; e2e 433/433). Tested by the owner and on the Galaxy S8 with real data.

### Where things are
- Backend: `infra/lambda/console/growth-tasks.ts` (tasks, lifecycle, comments/history, emails),
  `growth-goals.ts` (settings, goals/KRs, milestones, progress, strategy seed), `growth-records.ts`
  (partners, posts, tagged links), `growth-workspace.ts` (AI output → tasks, migration, the workspace
  endpoint, results loop, Monday digest), `growth.ts` (weekly analysis; drafts on tasks: PRs for
  page/content/fix, text for social/listing/partner), `roles.ts` (growth_lead, growth_contributor).
- Routes: `GET /growth/workspace`, `GET|POST /growth/tasks`, `GET|PATCH /growth/tasks/<id>`,
  `POST /growth/tasks/<id>/comments`, `POST /growth/tasks/<id>/draft`, `PUT /growth/settings`,
  `PUT /growth/goals/<id>`, `PUT|DELETE /growth/partners/<id>`, `PUT|DELETE /growth/posts/<id>`,
  `GET /growth` (Insights detail), `POST /growth/run`, `PUT /growth/tools`.
- Console: `console/src/pages/growth/` (index, shared, main-views: Today/Goals/Tasks, task-panel,
  workstreams incl. partnerships pipeline and social calendar, other-views: Insights/Settings/Start here).
- Hourly Console job (`index.ts` alerts): `growthHousekeeping` = daily results loop + Monday 03:00 UTC digest.
- First load seeds goals O1/O2/O3/Health, milestones A/B/C and 23 strategy tasks (incl. the 5 owner
  decisions), and migrates the old recommendations, proposals and opportunities into tasks (once).

### After the owner's first review (2026-10-30)
- One-time cleanup (`cleanupV2`, marker `MIGRATED#TASKS2`, 21 changes): migrated suggestions that were done → Done with proof; duplicates and "hold" advice → Won't do with the reason; real actions → Ready with owner and due date; strategy tasks got real priorities and dates.
- `similar()` guard: the agent can't add the same idea twice in other words (it notes "suggested again" on the existing task).
- Priority: P0 only for high-impact, confident work that isn't huge (`priorityOf`).
- Today: My work = in progress → overdue → due soon → priority (decisions only under "Needs a decision"); desktop has goals and decisions beside your work; phones show work first with two-up numbers; growth pages use up to 1600 px.
- Task panel leads with what and why; goals show "Just started" in the first tenth of their period; sign-in returns to the page you were opening.

## Group 1: SEO tools (2026-10-30)
Console → Workstreams → **SEO tools** (`console/src/pages/growth/seo.tsx`, `infra/lambda/console/growth-seo.ts`, tests `growth-seo.test.ts`):
- **Keywords:** tracked keywords (`GROWTH / KEYWORD#`, seeded from SEED_KEYWORDS and task keywords) with Google position, impressions and clicks over 28 days and a 12-week position trend from the daily Search Console rows; Bing position (GetQueryStats) and Bing demand; every query Google showed us for.
- **Technical audit:** every sitemap page (status, title/description length, H1, canonical, noindex, hreflang en/hi/x-default, lang, JSON-LD, og:image, thin < 300 words, images without alt, broken internal links, Google index state) → `GROWTH / SEOAUDIT` + `SEOHIST#<day>`; health score; "Make it a task" per issue type. First real run: 64 pages, 0 errors, 67 warnings, score 97.
- **Speed:** PageSpeed Insights (Lighthouse) for 5 key pages, mobile and desktop, plus real-user Core Web Vitals when Google has them. Key: SSM `/lens/growth/pagespeed-key` (API key restricted to PageSpeed, project lens-5df67). First run: 99–100 everywhere, LCP 0.3–1.4 s.
- **Backlinks & link building:** links Bing found (GetLinkCounts/GetUrlLinks); a pipeline of places to get a link (`PROSPECT#`, seeded with 12 real ones) whose pages are fetched weekly and moved to "live" when they link to the site.
- Runs weekly in the analysis (facts `seo.audit_score`, `seo.audit_errors`, `seo.audit_warnings`, `seo.broken_links`, `seo.backlinks` for the agent) and on demand ("Run audit again" → GrowthAnalyst `{seoAudit:true}`).

## Group 2: Competitors (2026-10-30)
Console → Workstreams → **Competitors** (`console/src/pages/growth/competitors.tsx`, `infra/lambda/console/growth-competitors.ts`, tests `growth-competitors.test.ts`):
- List `GROWTH / COMPETITOR#` seeded with 8 from the strategy (Google Photos, TeraBox, JioAICloud, Amazon Photos, Degoo, Kululu, Guestpix, WedShoots); add/edit/stop watching.
- Weekly (with the analysis) and on demand ("Check now"): homepage title, description, headlines, prices on the page, sitemap size; diff against last week → changes and new pages (`COMPSNAP#<id>#<day>`; page addresses kept as 10-character fingerprints so a row never nears DynamoDB's 400 KB). Facts `comp.<name>.changes` / `.new_pages` for the agent.
- Agent tool `competitor_page` (level 1): reads public pages on listed competitor hosts only (enforced in the tool server; anything else refused). "Research" creates a research task the agent drafts as a **competitor brief** (positioning, prices quoted, features, strengths, weaknesses, what to learn, where Lens wins), stored on the competitor and the task.
- Plain fetch reads 7 of 8 sites fully (237–4,784 words). A page with almost no text is flagged "needs a browser crawler" (then add Crawl4AI or similar to the analyst image). TeraBox didn't answer from the office network: check from AWS.

## Group 3: Campaigns, budget and the monthly review (2026-10-30)
- **Campaigns & budget** (`console/src/pages/growth/money.tsx`, `infra/lambda/console/growth-money.ts`, tests `growth-money.test.ts`): `CAMPAIGN#` (channel, type, goal, dates, budget, landing page, owner, status, generated code and tagged link) and `SPEND#` (date, ₹, category, campaign). Per campaign: visits (our analytics, 90 days), installs/activated/signed in/paying (PROFILE.acquisition.campaign, from the Play install referrer), spend, cost per visit/install/activated/paying, estimated revenue (paying × ₹59) and ROI. By month: spend, installs, activated, paying, cost per install, estimated ROI (analytics `campaignInstalls`, `installsByMonth`). Spend is logged by growth leads and owners.
- **Monthly review** (`growth.ts` runMonthly, `growth-report.ts` MONTHLY_SYSTEM/SCHEMA, `console/src/pages/growth/monthly.tsx`): EventBridge `MonthlyGrowthReview` on the 1st at 03:30 UTC, or "Write last month's review" (Insights). Month facts computed by code (installs, activated, paying, spend, cost per install, tasks finished/created/open/blocked, results measured and worked, SEO health start/end, competitor changes) + finished and measured tasks + goals + weekly summaries; Claude writes headline, summary, wins, misses, next month; numbers checked against the month's facts (`aiProblems` if not). Stored `MONTHLY#YYYY-MM`, emailed to owners.

## Group 4: Website tools (2026-10-30)
- **Website analytics (GA4)** (Console → Workstreams; `console/src/pages/growth/website.tsx` Ga4Page, `GET /growth/ga4`): the maintenance job pulls 28 days from the GA4 Data API daily (`pullGa4Snapshot` in `infra/lambda/api/search-console.ts`, property 558351960) → `GROWTH / GA4SNAP`: sessions/users/engaged/key events per day, channels, landing pages (engagement, time, key events), countries, devices, events. GA4 counts only visitors who allow analytics; our own website analytics counts everyone.
- **Titles & descriptions** (SEO tools tab): every audited page's title and meta description, editable with length guides. "Send changes to the agent" → `POST /growth/seo/meta` (`growth-content.ts` checkMeta) creates one fix task (spec `{kind:'meta', changes}`, owner agent, reviewer = you); the agent's draft sets exactly those values in `site/src/content/*.ts` and opens a PR. Nothing reaches the site until someone merges.
- **Blog** (`site/src/content/blog.ts`, `site/src/components/BlogHub.astro`, routes in `site/src/pages/[...path].astro`): `/blog/` and `/blog/<slug>/` in English and Hindi, rendered like guides (FAQ, breadcrumbs, next-step links). The blog appears only once it has a post. The draft agent knows to add posts there (DRAFT_SYSTEM rule 2).
- **Content calendar** (`GET /growth/calendar?month=&content=1`, `calendarItems`): task due dates, social posts, partner follow-ups and campaign start/end in one month; "content only" filter; undated content tasks and undated post ideas listed so nothing gets lost.

## Group 5: Account integrations (code ready, keys later; 2026-10-30)
`infra/lambda/api/growth-integrations.ts`, daily in the maintenance job (`pullIntegrations` → `GROWTH / INTEG#<name>`), Console → Workstreams → **Integrations** (`GET /growth/integrations`). Every one shows **not connected** with its setup steps until its SSM SecureString exists; read-only (stats), no posting or sending yet.

| Integration | SSM parameter | JSON | What it shows |
|---|---|---|---|
| Instagram & Facebook (Meta Graph API v21) | `/lens/growth/instagram` | `{"accessToken","igUserId","pageId"?}` | followers, posts, latest 10 posts with likes/comments, Facebook Page followers |
| YouTube Data API v3 | `/lens/growth/youtube` | `{"apiKey","channelId"}` | subscribers, views, videos, latest 10 videos with views/likes/comments |
| Pinterest API v5 | `/lens/growth/pinterest` | `{"accessToken"}` | followers, monthly views, 30-day impressions/saves/outbound clicks |
| Email (Amazon SES) | `/lens/growth/email` | `{"from","secret"}` | accounts that opted in / opted out |

Email consent: `PUT /v1/me/marketing-email {on}` sets `PROFILE.marketingEmail` (off unless turned on; the app switch is still to build); `GET|POST /v1/email/unsubscribe?u=&t=` (HMAC token from the secret, one-click) turns it off. Re-engagement uses the existing push campaigns (Notifications page, with approval); communities and creators are partners (type community/influencer).

To do when connecting: put the keys in SSM (owner OK needed), wait for the next daily run (or invoke the maintenance Lambda), check the Integrations page. Later: posting from approved drafts, SES sends with List-Unsubscribe headers, app consent switch.
