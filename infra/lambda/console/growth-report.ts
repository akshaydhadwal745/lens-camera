// Weekly growth report (docs/growth/growth-engine.md §2): rule-based findings that need no AI, the
// analyst's instructions + output schema, and the validator that rejects any number the analyst
// didn't take from a cited fact. Pure (tested in growth-report.test.ts).
import { notable, type Fact } from './growth-facts';

export type Finding = { severity: 'high' | 'medium' | 'low'; title: string; detail: string; facts: string[] };
export type Recommendation = {
  title: string;
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
export type AiReport = { summary: string; findings: Finding[]; recommendations: Recommendation[]; reviewOfPrevious: { id: string; verdict: string; facts: string[] }[]; seoInvestigations?: Investigation[] };
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
- For each previous recommendation that was shipped, judge from the facts whether it worked, or say the data can't tell yet.
- Plain English for a non-specialist founder. No hype.

You also have growth tools (MCP server "growth"): Search Console data (search_analytics, compare_periods, inspect_url, list_sitemaps), live page audits (audit_page) and the website code at the current main commit (find_in_code, read_code). Use them to investigate the most important SEO findings down to the code, then report each in "seoInvestigations":
- "evidence": "measured" (the data shows it), "likely-cause" (code evidence explains measured data), or "hypothesis" (plausible, not yet shown). Never present a hypothesis as a cause.
- "codeLocations": exact file, line and the line's text, copied from find_in_code/read_code/audit_page results (they are checked against the code).
- Numbers in investigations must come from facts or tool results.
- Search Console needs impressions before CTR, ranking or query work means anything; with none, focus on indexing and say why.
- Use watch_page for each page you recommend changing. Use propose_change only for a specific, evidence-backed code change (it creates a proposal for the owner; it changes nothing). Level-2 tools may be refused if not enabled; that's fine.
- Be economical: about 25 tool calls at most.`;

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
        required: ['title', 'hypothesis', 'expectedImpact', 'effort', 'cost', 'timeToResult', 'risk', 'metric', 'stopRule', 'facts'],
        properties: {
          title: { type: 'string' },
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
  return problems;
}
