# SEO agent: search data → code → PR → measured outcome (2026-10-29)

Builds on `growth-engine.md` (facts engine, weekly analyst, Console → Growth). Goal: find SEO
opportunities in real data, trace them to the exact code, propose a focused fix as a PR, and
measure the result honestly.

## 1. Where we are (live data, 2026-10-29)

| Signal | Value | Source |
|---|---|---|
| Search impressions, last 16 months | **0** (no queries at all) | Search Analytics API |
| Sitemap | read by Google 2026-10-29 10:19 UTC, 64 URLs, 0 errors, 0 warnings | Sitemaps API |
| Indexed | **1 / 64** (the homepage, crawled 12:06 UTC) | URL Inspection API |
| Discovered, not indexed | 46: all found **via the homepage**, not crawled yet | URL Inspection (`referringUrls`) |
| Unknown to Google | 17 | URL Inspection |
| Technical check of the built site | **0 errors**; 80 warnings: 23 long titles, 17 description lengths, 26 thin pages, 12 weakly linked pages, 2 geo-targeting | `site/scripts/seo-check.mjs` |

**What this means.** There's no click, CTR or ranking data to optimise yet: query and CTR work
starts once impressions exist. Indexing is the bottleneck, and Google's own data says why: it found
every page through the homepage but hasn't spent crawl budget on a new domain with no outside
links. Internal links aren't the cause (all pages are reachable from the homepage). **The highest
impact work is outside the code:** links from places Google already crawls (the Play listing once
public, the public GitHub repo, social profiles, Product Hunt, directories, partners) and time.
The agent must say this instead of inventing code fixes.

### Prioritised findings
| # | Finding | Evidence | Impact | Confidence | Effort | Time to result |
|---|---|---|---|---|---|---|
| 1 | Pages not indexed (new domain, no outside links) | 1/64 indexed; 46 "discovered" via the homepage, never crawled | Very high | High | Owner: links + Request indexing in Search Console | 2–8 weeks |
| 2 | English pages tagged as **English-for-India** (`en-IN`) on a worldwide site | `Layout.astro:64`, `astro.config.mjs:18`; hreflang en-IN/hi-IN in every page and the sitemap | Medium (geo hint for non-Indian searches) | Medium: hreflang is a hint | 10 min (**PR open**) | Weeks after impressions start |
| 3 | 23 titles over ~60 characters (Google truncates) | checker, each with its source line (e.g. `content/pages.ts:35`) | Medium for CTR | Medium | 1–2 h, together with the positioning rewrite | Needs impressions to measure |
| 4 | 26 pages under 300 words (feature pages, use-cases hub) | checker word counts | Medium for indexing quality | Low–medium | Writing time | Months |
| 5 | Affiliate pages have no in-content links | checker inbound links | Low | High | 15 min | — |

## 2. Architecture, and where I'd change your plan

### 2.1 Code retrieval: route map + agentic search, not embeddings (for now)
The SEO-relevant code is small and very structured: one Astro layout, three content files
(`site/src/content/*.ts`), a few components and `astro.config.mjs`, ~60 files in all.

| Option | Accuracy for "which code makes this page's title/canonical/links?" | Cost | Maintenance |
|---|---|---|---|
| **Deterministic route map** (built page → exact source line, by matching the rendered title/description text and the route table) | **Exact** | ₹0 | None: computed from the build each run |
| Agent with Read/Grep/Glob on a fresh checkout (Claude Code does this natively) | Very high: it reads the real current code | Subscription usage | None |
| GitHub code search API | Good for keywords; no semantics; rate-limited | ₹0 | None |
| Embeddings + vector DB | Approximate; good for fuzzy "where is X handled" in big repos | Embedding + DB costs, small | Index pipeline, staleness, branch versions |

**Decision:** the route map (`seo-check.mjs` already traces every finding to `file:line`), plus the
agent reading a fresh checkout at the PR's base commit. That's exact, always current and costs
nothing. Embeddings only become worth it if we index the whole monorepo (app + infra, thousands of
files) for non-SEO questions. Even then a hybrid (ripgrep/AST first, embeddings as fallback) beats
pure embeddings for code. Re-evaluate when the agent's investigations start missing relevant code.
That's the measurable trigger, not a guess. So the "keep the index updated in CI" requirement
becomes: **nothing to keep updated**. The map is rebuilt from the build each time, so it can't go stale.

### 2.2 Tools: an MCP server inside the analyst container
The analyst already runs the Claude Code CLI, which supports MCP natively. So the tools are a small
**stdio MCP server in the same container** (`growth-mcp`), and Claude calls them directly. Permissions are enforced **in
the server, not in the prompt**:

| Level | Tools | Enforcement |
|---|---|---|
| 1 Read | `search_analytics` (query/page/country/device/date/type, compare ranges), `inspect_url`, `list_sitemaps`, `list_properties`, `site_check` (runs seo-check on a checkout), `read_code` (fresh checkout, read-only), `growth_facts` | Always on |
| 2 Low-risk, reversible | `submit_sitemap`, `refresh_report`, `open_issue`/`comment` on our repo | Each tool off until the owner enables it in Console → Growth → Tools; per-day limits |
| 3 Approval required | `create_pull_request` (branch + PR only: no merge, no protected branches), future content or robots changes | The tool writes a **proposal** row; it runs only after the owner clicks Approve in the Console; the GitHub App can't merge |

Every call writes an audit row (`GROWTH / ACT#<time>`): tool, reason, parameters, result, error,
related finding, report or PR. Integrations are switched off with one Console toggle, and access is
revoked by deleting the SSM key or uninstalling the GitHub App.

**What Google's APIs can and can't do (checked against the docs):**
- Search Analytics: up to 16 months, 25,000 rows per request, by query/page/country/device/date/search type. Data is ~2–3 days behind.
- URL Inspection: index status, last crawl, canonical (Google's and ours), referring URLs, robots and indexing state, mobile usability. **2,000 per day and 600 per minute per property.**
- Sitemaps: list, get, submit, delete. Sites: list, add.
- **Not available:** "Request indexing" (the Indexing API is only allowed for job postings and livestream events, so using it for normal pages breaks Google's rules), removals, the Links report, the Core Web Vitals report (use the CrUX API instead), and manual actions. These stay as owner clicks in the Search Console UI.

### 2.3 GitHub App (least privilege)
Created by the owner (GitHub → Settings → Developer settings → GitHub Apps → New), installed **only on `lens-camera`**:

| Permission | Level | Why |
|---|---|---|
| Metadata | Read | Required |
| Contents | Read & write | Read code; push commits **to its own branches** (`agent/*`) |
| Pull requests | Read & write | Open and update its PRs |
| Checks / Commit statuses | Read | See CI results on its PRs |
| Actions | Read | Read workflow runs and logs |
| Issues | Read & write (optional) | Report findings that aren't code |
| **Workflows** | **None** | It can't change `.github/workflows` (hard rule) |
| **Administration, Secrets, Environments, Deployments** | **None** | It can't change rules, read secrets or deploy |

Plus **branch protection on `main`**: PR required, CI checks required, the App **not** in the bypass
list. Private key in SSM (`/lens/growth/github-app`), short-lived installation tokens per run. The
App can only open PRs; a human reviews and merges, and the existing deploy flow ships.

### 2.4 The loop
1. **Collect:** daily Search Console pull (built), weekly index coverage and site check.
2. **Detect:** facts engine (deltas, anomalies, low CTR, page-two queries, newly unindexed pages).
3. **Prioritise:** impact × confidence ÷ effort, with expected time to results.
4. **Investigate:** route map → exact source lines; the agent reads the current code at `main` HEAD.
5. **Recommend:** with evidence labelled **measured** (data), **likely cause** (code evidence) or **hypothesis** (needs validation).
6. **PR:** a focused change plus a test or check, opened by the App, with the evidence template (§4).
7. **Check:** the SEO check, Lighthouse and the build run on the PR (CI).
8. **Approve:** the owner reviews and merges. Nothing merges or deploys itself.
9. **Monitor:** affected pages added to a watchlist (index state, impressions, CTR, position, landing → install).
10. **Measure:** compare against the baseline only after Search Console's ~3-day lag plus at least 28 days, and with enough impressions. Otherwise "can't tell yet". Never claim causation from a single before/after; note confounders (seasonality, other deploys, Google updates).

### 2.5 Measuring what matters
SEO traffic only counts if it brings users who back up and come back. The pieces exist:
website source (`src#`) → `utm` on Play links (launch day) → `PROFILE.acquisition` (built) →
activation and D7 by channel (built). Next: landing page as `utm_content` on the site's Play buttons,
so "which landing pages produce users who back up" becomes a fact.

## 3. Proof of concept (done 2026-10-29)
- **Finding (data):** every page and the sitemap say `hreflang="en-IN"`, English for India, on a site meant for everyone. Detected by `seo-check.mjs` (`geo-targeting`).
- **Root cause (code):** `site/src/layouts/Layout.astro:64-65` (page tags), `:46` (JSON-LD `inLanguage`), `site/astro.config.mjs:18` (sitemap locales).
- **Fix:** language-only tags (`en`, `hi`, `x-default`). The checker goes from 2 geo warnings to 0, and the build and other checks are unchanged.
- **Validation:** CI SEO check on the PR. After deploy, `curl` the page and the sitemap for the new tags; URL Inspection shows the page fetched with the new HTML.
- **Measurement:** country split of impressions (`GSC#… c#` rows) once impressions exist. Baseline today: 0 impressions, so this can't be judged for weeks, and the report must say so. Watchlist: `/`, `/features/free-cloud-backup/`, `/compare/google-photos/`.
- **CI:** `.github/workflows/seo-check.yml` (pull requests) and a step in `web.yml` (before every deploy). Errors fail, warnings are listed.

## 4. PR template (agent and humans)
**What the data shows** (facts with ids, dates) · **Likely cause** (file:line, labelled measured /
likely / hypothesis) · **Change** · **Why it should help** · **Validation** (checks, preview) ·
**How we'll measure** (metric, pages, baseline, earliest date to judge) · **Risk and rollback**.

## 5. Phased plan
| Phase | What | Effort | Cost | Owner needs to |
|---|---|---|---|---|
| A (done today) | Live SEO baseline, `seo-check.mjs` with code tracing, CI checks, POC PR | — | ₹0 | Review and merge the PR |
| B (next) | MCP server with Level-1 tools; the analyst runs the SEO investigation weekly; findings with `file:line` in Console → Growth; watchlist and outcome tracking | 1–2 days | ₹0 (subscription) | — |
| C | GitHub App + Level-3 `create_pull_request` with approval in the Console; PR status in the ledger | 1 day | ₹0 | Create the App (10 min, I'll guide), enable branch protection without bypass |
| D | Level-2 tools (sitemap submit etc.) after 4 clean weeks; landing page → install attribution; Play Console reports | 1–2 days | ₹0 | Enable tools one by one |
| E (only if needed) | Code embeddings for whole-repo questions, if investigations miss code | 2–3 days | ~₹100–300/month | Decide on the evidence |

**Running cost:** Lambda and Actions free tier, the ECR image ~₹10–25/month, Claude on the
subscription (weekly runs plus PR investigations). **Maintenance:** bump the pinned Claude Code CLI
version occasionally; Google API changes; review PRs.
**Risks:** acting on thin data (mitigated by "can't tell yet" rules and evidence labels); the
subscription token expiring (the report falls back to rule-based); a GitHub App key leak (it can
only open PRs; revoke by uninstalling).
