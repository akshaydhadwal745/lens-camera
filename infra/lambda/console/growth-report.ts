// Weekly growth report (docs/growth/growth-engine.md §2): rule-based findings that need no AI, the
// analyst's instructions + output schema, and the validator that rejects any number the analyst
// didn't take from a cited fact. Pure (tested in growth-report.test.ts).
import { notable, type Fact } from './growth-facts';

export type Finding = { severity: 'high' | 'medium' | 'low'; title: string; detail: string; facts: string[] };
export type Recommendation = {
  title: string;
  workstream: 'launch' | 'search' | 'social' | 'store' | 'retain' | 'loops' | 'partners';
  hypothesis: string;
  expectedImpact: string;
  effort: 'low' | 'medium' | 'high';
  cost: string;
  timeToResult: string;
  risk: string;
  metric: string;
  stopRule: string;
  facts: string[];
};
export type CodeLocation = { file: string; line: number; excerpt: string };
export type Investigation = {
  title: string;
  evidence: 'measured' | 'likely-cause' | 'hypothesis';
  data: string;
  cause: string;
  codeLocations: CodeLocation[];
  recommendation: string;
  validation: string;
  measurement: string;
  facts: string[];
};
export type Brief = {
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  outline: string[];
  questions: string[];
  supportingKeywords: string[];
  internalLinksFrom: string[];
  internalLinksTo: string[];
  searchResultsToday: string;
};
export type Opportunity = {
  topic: string;
  targetKeyword: string;
  intent: 'problem' | 'informational' | 'comparison' | 'commercial';
  audience: string;
  lensFeatures: string[];
  relevance: 0 | 1 | 2 | 3;
  relevanceReason: string;
  demand: 'high' | 'medium' | 'low' | 'unmeasured';
  demandEvidence: string;
  trend: 'rising' | 'seasonal' | 'steady' | 'falling' | 'unknown';
  winnability: 'high' | 'medium' | 'low';
  competition: string;
  action: 'improve-page' | 'new-guide' | 'landing-page' | 'faq-and-links' | 'conversion-fix' | 'social-post' | 'experiment';
  existingPage: string;
  brief: Brief;
  businessValue: string;
  measurement: string;
  facts: string[];
};
export type AiReport = { summary: string; findings: Finding[]; recommendations: Recommendation[]; reviewOfPrevious: { id: string; verdict: string; facts: string[] }[]; seoInvestigations?: Investigation[]; opportunities?: Opportunity[] };

/** Priority from the analyst's graded inputs (shown with its parts in the Console; relevance 0 is never kept). */
export function opportunityScore(o: Pick<Opportunity, 'relevance' | 'demand' | 'trend' | 'winnability'>): number {
  const demand = { high: 3, medium: 2, low: 1, unmeasured: 0.5 }[o.demand];
  const trend = { rising: 1.5, seasonal: 1.25, steady: 1, unknown: 0.9, falling: 0.6 }[o.trend];
  const win = { high: 1.5, medium: 1, low: 0.5 }[o.winnability];
  return Math.round(o.relevance * demand * trend * win * 10) / 10;
}

/** Feature names from docs/growth/product-facts.md ("- **Name**: …" under "## Features"). */
export function productFeatures(md: string): string[] {
  const part = md.split(/^## /m).find((x) => x.startsWith('Features')) ?? '';
  return [...part.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1]);
}
export type OpenRec = { id: string; title: string; status: string; createdAt: string; metric: string; note?: string };

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 1000) / 10}%`);
const byId = (facts: Fact[]) => new Map(facts.map((f) => [f.id, f]));

/** Findings from fixed rules: available every week, AI or not. */
export function ruleFindings(facts: Fact[]): Finding[] {
  const f = byId(facts);
  const v = (id: string) => f.get(id)?.value ?? null;
  const out: Finding[] = [];
  const pages = v('search.sitemap_pages');
  const indexed = v('search.indexed_pages');
  if (pages && indexed !== null && indexed < pages * 0.5)
    out.push({ severity: 'high', title: 'Most website pages are not in Google yet', detail: `Google has indexed ${indexed} of ${pages} pages. Pages that aren't indexed can't bring search visitors. Links from sites Google already crawls (Play listing, social profiles, directories, partners) and "Request indexing" for key pages are the fix.`, facts: ['search.indexed_pages', 'search.sitemap_pages'] });
  if ((v('search.impressions') ?? 0) === 0) out.push({ severity: 'high', title: 'No search visibility yet', detail: 'Lens did not appear in any Google results in the last 28 days.', facts: ['search.impressions'] });
  for (const lf of facts.filter((x) => /^search\.lowctr\.\d+\.ctr$/.test(x.id))) {
    const imp = f.get(lf.id.replace('.ctr', '.impressions'));
    out.push({ severity: 'medium', title: `Rewrite the title and description: ${lf.label.replace(/^High impressions, low clicks: | \(click-through rate\)$/g, '')}`, detail: `Seen ${imp?.value} times but clicked ${pct(lf.value)} of the time.`, facts: [lf.id, imp?.id ?? ''].filter(Boolean) });
  }
  for (const p2 of facts.filter((x) => x.id.startsWith('search.page2.')))
    out.push({ severity: 'medium', title: `Close to page one: ${p2.label.replace(/^Near page one: | \(average position\)$/g, '')}`, detail: `Average position ${p2.value}. Strengthening that page (content, internal links) could move it onto page one.`, facts: [p2.id] });
  const visits30 = v('web.visits_30d');
  if (visits30 !== null && visits30 < 100) out.push({ severity: 'high', title: 'Almost no website traffic', detail: `${visits30} visits in 30 days. Distribution, not the website itself, is the bottleneck.`, facts: ['web.visits_30d'] });
  const installs = v('app.installs') ?? 0;
  const backedUp = v('app.upload_rate');
  if (installs >= 20 && backedUp !== null && backedUp < 0.6) out.push({ severity: 'high', title: 'Many installs never back up a photo', detail: `Only ${pct(backedUp)} of new installs backed up anything: the first-run experience is losing people.`, facts: ['app.installs', 'app.upload_rate'] });
  const d7 = f.get('app.retention_d7');
  if (d7?.value !== null && d7?.value !== undefined && installs >= 20 && d7.value < 0.2) out.push({ severity: 'high', title: 'Week-one retention is low', detail: `D7 retention is ${pct(d7.value)}. Fix this before spending on acquisition.`, facts: ['app.retention_d7', 'app.installs'] });
  for (const x of facts.filter(notable))
    out.push({ severity: 'low', title: `${x.label}: ${x.change! > 0 ? 'up' : 'down'} ${pct(Math.abs(x.change!))} week on week`, detail: `${x.previous} → ${x.value} (${x.window}).`, facts: [x.id] });
  if (installs < 20) out.push({ severity: 'low', title: 'Too few installs to judge activation and retention', detail: `${installs} installs in 30 days; rates become meaningful from about 20–30.`, facts: ['app.installs'] });
  return out;
}

export const ANALYST_SYSTEM = `You are the growth analyst for Lens, an Android camera app that backs up every photo in full quality (free tier plus a paid plan), with share links that keep original quality and QR event albums guests join from the browser. The team is a solo founder with little money: organic growth first, paid ads only after retention is proven, and unit economics matter (free storage costs money).

You receive FACTS (computed by code; each has an id), the previous recommendations with their status, and rule-based findings. Write the weekly growth report.

Hard rules:
- Use ONLY numbers that appear in the facts you cite. Never compute new numbers, estimate, or invent figures; never quote a number without listing its fact id in that item's "facts".
- Facts with unit "pct" are fractions (0.599 means 59.9%): always write them as percentages. Facts with unit "usd" are US dollars.
- If data is too thin to conclude something, say so plainly instead of guessing.
- Every recommendation needs a falsifiable hypothesis, expected impact (direction and which metric, no invented figures), effort, cost in plain words, time to result, risk, the metric to watch and a stop rule.
- Prefer few, specific, high-leverage recommendations (at most 5) over generic advice. Name the exact page, query, channel or screen.
- Each recommendation becomes a task in the growth workspace: give it a "workstream" (launch = Play launch; search = SEO and content; social = social and distribution; store = website and Play Store conversion; retain = activation, retention, revenue; loops = referrals, event albums, sharing; partners = partnerships) and a title phrased as the action to take.
- The "previous recommendations" you receive are the workspace's open and recently finished tasks: don't suggest what is already there; judge finished ones from the facts.
- For each previous recommendation that was shipped, judge from the facts whether it worked, or say the data can't tell yet.
- Plain English for a non-specialist founder. No hype.

You also have growth tools (MCP server "growth"): Search Console data (search_analytics, compare_periods, inspect_url, list_sitemaps), live page audits (audit_page) and the website code at the current main commit (find_in_code, read_code). Use them to investigate the most important SEO findings down to the code, then report each in "seoInvestigations":
- "evidence": "measured" (the data shows it), "likely-cause" (code evidence explains measured data), or "hypothesis" (plausible, not yet shown). Never present a hypothesis as a cause.
- "codeLocations": exact file, line and the line's text, copied from find_in_code/read_code/audit_page results (they are checked against the code).
- Numbers in investigations must come from facts or tool results.
- Search Console needs impressions before CTR, ranking or query work means anything; with none, focus on indexing and say why.
- Use watch_page for each page you recommend changing. Use propose_change only for a specific, evidence-backed code change (it creates a proposal for the owner; it changes nothing). Level-2 tools may be refused if not enabled; that's fine.
- Be economical: about 25 tool calls at most for SEO.

CONTENT OPPORTUNITIES ("opportunities", at most 6): what people are interested in that Lens can genuinely help with, and the page that would serve them.
- Sources, each a different scale; never mix them up or call one "search volume" of another: Bing searches (keyword_volume, related_keywords: real counts, Bing only, small in India), Wikipedia views (topic_interest: long-term interest), Google "Trending now" (trending_now: today's spikes, mostly irrelevant), our own Search Console impressions and website/GA4 behaviour (ga4_report). Google Trends itself isn't connected yet.
- Read docs/growth/product-facts.md first (read_code). "lensFeatures" must use feature names exactly as listed under Features; never promise anything under "Not available".
- Relevance 0–3: 3 = Lens directly solves the searcher's problem; 0 = no real link (leave it out). Don't chase trends Lens can't help with.
- "demand": high/medium/low from the numbers you found, or "unmeasured"; "demandEvidence" quotes those numbers with their source (only numbers from facts or tool results). "trend": from 12-week Bing change, Wikipedia year-on-year, or known seasonality (Indian weddings peak Nov–Feb).
- "winnability": can a new site rank? Consider whether we already get impressions, whether the results are dominated by big brands, and how specific the problem is.
- Prefer improving an existing page (find it with find_in_code/audit_page; set "existingPage") over a new one when it covers the intent. One page per intent; no near-duplicates of existing pages.
- The brief must be specific: URL path, title ≤ 60 characters, meta description ≤ 155, H1, outline (H2s), real questions people ask (from related_keywords), supporting keywords, internal links from and to existing pages, and a one-line view of what ranks today if you know it (else "not checked").
- Content principles: written for the reader's problem first, original and accurate, honest about alternatives; no keyword stuffing; no mass-produced pages.
- About 20 more tool calls for this part.`;

export const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'recommendations', 'reviewOfPrevious'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['severity', 'title', 'detail', 'facts'], properties: { severity: { enum: ['high', 'medium', 'low'] }, title: { type: 'string' }, detail: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } } },
    },
    recommendations: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'workstream', 'hypothesis', 'expectedImpact', 'effort', 'cost', 'timeToResult', 'risk', 'metric', 'stopRule', 'facts'],
        properties: {
          title: { type: 'string' },
          workstream: { enum: ['launch', 'search', 'social', 'store', 'retain', 'loops', 'partners'] },
          hypothesis: { type: 'string' },
          expectedImpact: { type: 'string' },
          effort: { enum: ['low', 'medium', 'high'] },
          cost: { type: 'string' },
          timeToResult: { type: 'string' },
          risk: { type: 'string' },
          metric: { type: 'string' },
          stopRule: { type: 'string' },
          facts: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    reviewOfPrevious: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'verdict', 'facts'], properties: { id: { type: 'string' }, verdict: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } } },
    },
    opportunities: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'targetKeyword', 'intent', 'audience', 'lensFeatures', 'relevance', 'relevanceReason', 'demand', 'demandEvidence', 'trend', 'winnability', 'competition', 'action', 'existingPage', 'brief', 'businessValue', 'measurement', 'facts'],
        properties: {
          topic: { type: 'string' },
          targetKeyword: { type: 'string' },
          intent: { enum: ['problem', 'informational', 'comparison', 'commercial'] },
          audience: { type: 'string' },
          lensFeatures: { type: 'array', items: { type: 'string' } },
          relevance: { enum: [0, 1, 2, 3] },
          relevanceReason: { type: 'string' },
          demand: { enum: ['high', 'medium', 'low', 'unmeasured'] },
          demandEvidence: { type: 'string' },
          trend: { enum: ['rising', 'seasonal', 'steady', 'falling', 'unknown'] },
          winnability: { enum: ['high', 'medium', 'low'] },
          competition: { type: 'string' },
          action: { enum: ['improve-page', 'new-guide', 'landing-page', 'faq-and-links', 'conversion-fix', 'social-post', 'experiment'] },
          existingPage: { type: 'string' },
          brief: {
            type: 'object',
            additionalProperties: false,
            required: ['url', 'title', 'metaDescription', 'h1', 'outline', 'questions', 'supportingKeywords', 'internalLinksFrom', 'internalLinksTo', 'searchResultsToday'],
            properties: {
              url: { type: 'string' },
              title: { type: 'string' },
              metaDescription: { type: 'string' },
              h1: { type: 'string' },
              outline: { type: 'array', items: { type: 'string' } },
              questions: { type: 'array', items: { type: 'string' } },
              supportingKeywords: { type: 'array', items: { type: 'string' } },
              internalLinksFrom: { type: 'array', items: { type: 'string' } },
              internalLinksTo: { type: 'array', items: { type: 'string' } },
              searchResultsToday: { type: 'string' },
            },
          },
          businessValue: { type: 'string' },
          measurement: { type: 'string' },
          facts: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    seoInvestigations: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'evidence', 'data', 'cause', 'codeLocations', 'recommendation', 'validation', 'measurement', 'facts'],
        properties: {
          title: { type: 'string' },
          evidence: { enum: ['measured', 'likely-cause', 'hypothesis'] },
          data: { type: 'string' },
          cause: { type: 'string' },
          codeLocations: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['file', 'line', 'excerpt'], properties: { file: { type: 'string' }, line: { type: 'number' }, excerpt: { type: 'string' } } },
          },
          recommendation: { type: 'string' },
          validation: { type: 'string' },
          measurement: { type: 'string' },
          facts: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export function analystPrompt(facts: Fact[], rules: Finding[], open: OpenRec[]): string {
  return [
    `FACTS (JSON, one per line):\n${facts.map((f) => JSON.stringify(f)).join('\n')}`,
    `RULE-BASED FINDINGS:\n${rules.map((r) => `- [${r.severity}] ${r.title} (${r.facts.join(', ')})`).join('\n') || '- none'}`,
    `PREVIOUS RECOMMENDATIONS:\n${open.map((r) => `- ${r.id} [${r.status}] ${r.title} — metric: ${r.metric}${r.note ? ` — note: ${r.note}` : ''} (since ${r.createdAt})`).join('\n') || '- none yet'}`,
    'Write this week’s report as the JSON object described by the schema.',
  ].join('\n\n');
}

// ---------- validation: every number must come from a cited fact ----------

const NUM = /(?<![\w.])-?\d+(?:[.,]\d+)*(?:\.\d+)?%?/g;
const norm = (s: string) => {
  const t = s.replace(/,/g, '');
  const n = Number(t.replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

/** The forms a fact's numbers may take in text: as is, rounded, and as a percentage for rates and changes. */
function allowedFor(f: Fact): number[] {
  const out: number[] = [];
  const add = (x: number | null | undefined, asPct: boolean) => {
    if (x === null || x === undefined) return;
    for (const y of asPct ? [x * 100, Math.abs(x * 100)] : [x, Math.abs(x)]) out.push(Math.round(y * 10) / 10, Math.round(y));
  };
  add(f.value, f.unit === 'pct');
  add(f.previous, f.unit === 'pct');
  if (f.unit === 'pct') for (const x of [f.value, f.previous]) if (x !== null && x !== undefined) out.push(Math.round(x * 1000) / 1000, Math.round(x * 100) / 100);
  add(f.change, true);
  if (f.value !== null && f.previous) add(f.value - f.previous, f.unit === 'pct');
  for (const m of `${f.label} ${f.window}`.match(NUM) ?? []) {
    const n = norm(m);
    if (n !== null) out.push(n);
  }
  return out;
}

/** Numbers in the text that no cited fact supports. Small counts of days/weeks (≤ 31) and years are fine. */
export function unsupportedNumbers(text: string, cited: string[], facts: Fact[]): string[] {
  const f = byId(facts);
  const allowed = new Set(cited.flatMap((id) => (f.get(id) ? allowedFor(f.get(id)!) : [])));
  const bad: string[] = [];
  for (const m of text.match(NUM) ?? []) {
    const n = norm(m);
    if (n === null) continue;
    if (!m.endsWith('%') && Number.isInteger(n) && (Math.abs(n) <= 31 || (n >= 2020 && n <= 2035))) continue;
    const forms = [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100, Math.round(n * 1000) / 1000];
    if (!forms.some((x) => allowed.has(x))) bad.push(m);
  }
  return bad;
}

/** Problems with an analyst report: unknown fact ids, numbers without a cited fact. Empty = valid. */
/** Numbers that tool results showed the analyst this run (they may be quoted in investigations). */
export function numbersIn(values: unknown[]): Set<number> {
  const out = new Set<number>();
  const add = (n: number) => {
    for (const x of [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100, Math.round(n * 1000) / 1000, Math.round(n * 1000) / 10, Math.round(n * 10000) / 100, Math.round(n * 100)]) out.add(x);
  };
  const walk = (v: unknown): void => {
    if (typeof v === 'number') add(v);
    else if (typeof v === 'string') for (const m of v.match(NUM) ?? []) {
      const n = norm(m);
      if (n !== null) add(n);
    }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  values.forEach(walk);
  return out;
}

/** Code locations that don't match the code copy (file missing, line out of range, or excerpt not on/near that line). */
export function unverifiedLocations(locs: CodeLocation[], readFile: (file: string) => string | undefined): string[] {
  const bad: string[] = [];
  for (const l of locs) {
    const body = readFile(l.file.replace(/^\/+/, ''));
    if (body === undefined) {
      bad.push(`${l.file}: no such file`);
      continue;
    }
    const lines = body.split('\n');
    const want = l.excerpt.trim().slice(0, 80);
    const near = lines.slice(Math.max(0, l.line - 3), l.line + 2).join('\n');
    if (l.line < 1 || l.line > lines.length) bad.push(`${l.file}:${l.line}: line out of range`);
    else if (want && !near.includes(want)) bad.push(`${l.file}:${l.line}: the quoted text isn't there`);
  }
  return bad;
}

export function validateReport(r: AiReport, facts: Fact[], toolNumbers: Set<number> = new Set(), readFile?: (file: string) => string | undefined): string[] {
  const ids = new Set(facts.map((f) => f.id));
  const problems: string[] = [];
  const fromTools = (m: string) => {
    const n = norm(m);
    return n !== null && [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100].some((y) => toolNumbers.has(y));
  };
  const check = (where: string, text: string, cited: string[]) => {
    for (const id of cited) if (!ids.has(id)) problems.push(`${where}: unknown fact id "${id}"`);
    // Numbers the tools returned this run are real data too.
    const bad = unsupportedNumbers(text, cited, facts).filter((m) => !fromTools(m));
    if (bad.length) problems.push(`${where}: numbers not in the cited facts: ${bad.join(', ')}`);
  };
  const allIds = facts.map((f) => f.id);
  check('summary', r.summary, allIds); // the summary may draw on any fact
  r.findings.forEach((x, i) => check(`finding ${i + 1}`, `${x.title} ${x.detail}`, x.facts));
  r.recommendations.forEach((x, i) => check(`recommendation ${i + 1}`, [x.title, x.hypothesis, x.expectedImpact, x.cost, x.timeToResult, x.risk, x.metric, x.stopRule].join(' '), x.facts));
  r.reviewOfPrevious.forEach((x) => check(`review ${x.id}`, x.verdict, x.facts));
  (r.seoInvestigations ?? []).forEach((x, i) => {
    const where = `investigation ${i + 1}`;
    for (const id of x.facts) if (!ids.has(id)) problems.push(`${where}: unknown fact id "${id}"`);
    const bad = unsupportedNumbers([x.title, x.data, x.cause, x.recommendation, x.validation, x.measurement].join(' '), x.facts, facts).filter((m) => {
      const n = norm(m);
      return n === null || ![n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100].some((y) => toolNumbers.has(y));
    });
    if (bad.length) problems.push(`${where}: numbers not in the cited facts or tool results: ${bad.join(', ')}`);
    if (readFile) for (const b of unverifiedLocations(x.codeLocations, readFile)) problems.push(`${where}: ${b}`);
  });
  const features = readFile ? new Set(productFeatures(readFile('docs/growth/product-facts.md') ?? '')) : undefined;
  (r.opportunities ?? []).forEach((o, i) => {
    const where = `opportunity ${i + 1} (${o.targetKeyword})`;
    for (const id of o.facts) if (!ids.has(id)) problems.push(`${where}: unknown fact id "${id}"`);
    const bad = unsupportedNumbers([o.demandEvidence, o.relevanceReason, o.competition, o.businessValue, o.measurement].join(' '), o.facts, facts).filter((m) => !fromTools(m));
    if (bad.length) problems.push(`${where}: numbers not in the cited facts or tool results: ${bad.join(', ')}`);
    if (features?.size) for (const f of o.lensFeatures) if (!features.has(f)) problems.push(`${where}: "${f}" is not a feature in product-facts.md`);
    if (o.brief.title.length > 60) problems.push(`${where}: title is ${o.brief.title.length} characters (max 60)`);
    if (o.brief.metaDescription.length > 160) problems.push(`${where}: meta description is ${o.brief.metaDescription.length} characters (max 160)`);
    if (!/^\/[a-z0-9\-/]*$/.test(o.brief.url)) problems.push(`${where}: url must be a lowercase path like /guides/topic/`);
  });
  return problems;
}

// ---------- drafts (Phase C): an approved opportunity or proposal becomes a pull request ----------

export const DRAFT_SYSTEM = `You are the growth agent for Lens (lens.instagrowapp.com), now making ONE change the owner approved: a content opportunity (with its brief) or a code proposal. You edit a copy of the website code; the system turns your edits into a pull request the owner reviews. You cannot merge or publish anything.

Tools: find_in_code and read_code (the website code at the current main commit), audit_page (the live page), edit_file (replace one exact piece of text in a file under site/src/content, components, pages, layouts or i18n).

How to work:
1. Read docs/growth/product-facts.md first. Only claim what is listed under Features; never promise anything under "Not available".
2. Find how the site is built before editing: pages are data in site/src/content (pages.ts, guides.ts, help.ts, info.ts) rendered by components; follow the existing structure, field names, tone and length of neighbouring entries exactly. New guides are new entries in the same data files, not new frameworks.
3. The site is English and Hindi. When you change English copy that has a Hindi counterpart, change the Hindi too, in natural Hindi as the existing copy is written (not word-for-word). For a brand-new page, add the Hindi entry only if the data file requires both languages; then write it properly.
4. Make the smallest change that fully does the approved task. Don't touch unrelated text, formatting or files. Keep titles ≤ 60 characters and meta descriptions ≤ 155. Add internal links the brief lists when an existing page clearly has a natural place for them.
5. Writing: for the reader's problem first; specific, accurate, honest about alternatives; no keyword stuffing, no filler, no invented numbers, quotes or testimonials.
6. If the task can't be done well (the brief conflicts with product facts, or the structure doesn't fit), make no edits and explain in "summary".

Answer with the pull request title (short, plain), a summary of what you changed and why, each changed file with what changed, the checks the owner should do before merging, and risks.`;

export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prTitle', 'summary', 'changes', 'checks', 'risks'],
  properties: {
    prTitle: { type: 'string' },
    summary: { type: 'string' },
    changes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'what'], properties: { file: { type: 'string' }, what: { type: 'string' } } } },
    checks: { type: 'array', items: { type: 'string' } },
    risks: { type: 'string' },
  },
} as const;

export type DraftResult = { prTitle: string; summary: string; changes: { file: string; what: string }[]; checks: string[]; risks: string };

/** Words that must never be added to the site (product-facts "Not available"), whatever the brief says. */
export const FORBIDDEN_CLAIMS = /\bunlimited\b|अनलिमिटेड|असीमित|\bfree forever\b/i;

// ---------- text drafts (W4.2): social posts, Play listing text, partner outreach ----------

export const TEXT_SYSTEM = `You are the growth agent for Lens (lens.instagrowapp.com), drafting text a person will review and then post or send themselves. You never post or send anything.

Tools: find_in_code and read_code (the website code and docs/growth), audit_page (a live page).

Rules:
1. Read docs/growth/product-facts.md first. Claim only what is under Features; never anything under "Not available". No invented numbers, users, reviews or testimonials.
2. Positioning: lead with the problem ("Phone full? Shoot everything.", full quality, events), not gigabytes. Honest about alternatives. English unless the task asks for Hindi; Hindi in natural Hindi.
3. Social posts: write for the channel (Instagram caption with a hook in the first line; Reddit helpful and non-promotional, answering the community's question first, following typical subreddit rules; LinkedIn build-in-public with a real lesson; WhatsApp short and personal; YouTube Shorts a 30-second script). Each post points to ONE website page that answers it.
4. Play listing: title ≤ 30 characters, short description ≤ 80, full description ≤ 4000 with a clear first line; no claims Play forbids (no "best", "#1", prices in the title, or calls to review).
5. Partner outreach: short, specific to the partner type, the value for them (their clients get photos from guests in full quality, free for them during the pilot), one clear ask; no pressure.
6. Give 2–4 options for each piece so the owner can choose. If the task can't be done well, say why in "notes" and give no drafts.
7. Competitor research (task says COMPETITOR RESEARCH): read their pages with competitor_page (homepage, pricing, features; at most 12 pages). Write ONE draft, kind "other", channel "other", title "Competitor brief: <name>", body in short sections: Positioning (their own words, quoted) · Plans and prices (exactly as listed, with the page) · Key features · Who it's for · Strengths · Weaknesses · What Lens should learn · Where Lens wins (only true product facts) · Watch for. Quote; never guess numbers. If a page can't be read, say so.`;

export const TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['drafts', 'notes'],
  properties: {
    drafts: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'channel', 'title', 'body', 'page', 'dayOffset'],
        properties: {
          kind: { enum: ['social-post', 'listing', 'outreach', 'other'] },
          channel: { enum: ['instagram', 'youtube', 'reddit', 'whatsapp', 'linkedin', 'x', 'facebook', 'blog', 'play', 'email', 'other'] },
          title: { type: 'string' },
          body: { type: 'string' },
          page: { type: 'string', description: 'website path the post links to, e.g. /guides/collect-wedding-photos-qr-code/' },
          dayOffset: { type: 'number', description: 'for posts: suggested days from today to publish (0–14)' },
        },
      },
    },
    notes: { type: 'string' },
  },
} as const;

export type TextDraft = { drafts: { kind: string; channel: string; title: string; body: string; page: string; dayOffset: number }[]; notes: string };
