// The weekly growth report (docs/growth/growth-engine.md §2) and its Console routes.
//   GROWTH / REPORT#<YYYY-MM-DD>  { facts, rules, ai?, aiProblems?, aiError?, model?, at, by }
//   GROWTH / REC#<id>             { id, title, …recommendation, status, note?, report, createdAt, updatedAt }
//   GROWTH / ACT#<at>#<n>         every growth-tool call: tool, level, args, ok, refused?, error?, result size, report
//   GROWTH / PROP#<id>            level-3 proposals (propose_change): status proposed → approved | rejected
//   GROWTH / WATCH#<path>         pages to follow after a recommendation: reason, since, baseline
//   GROWTH / TOOLS                { enabled: [...level-2 tool names] }, set by the owner
//   GROWTH / OPP#<slug>           content opportunities: brief, evidence, score; idea → planned → drafting → pr-open → published → measured | rejected
// The report runs in its own Lambda (GrowthAnalyst, a container with the Claude Code CLI, weekly and
// on demand). The Console reads and edits rows here. The analyst only reads facts; it changes nothing.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, HttpError, json, rateLimit, Req, Res } from '../api/lib';
import { googleToken, indexCoverage } from '../api/search-console';
import { compute } from './analytics';
import { demandFacts, fact, ga4Facts, indexFacts, productFacts, searchFacts, type Fact, type SearchDay, type SearchRow } from './growth-facts';
import { bingTrend, ga4Report, SEED_KEYWORDS, trendingNow, WIKI_ARTICLES, wikiTrend, wikiViews } from './growth-sources';
import { EDITABLE, installationToken, openPullRequest, pullRequestState } from './growth-github';
import { competitorHosts, watchCompetitors } from './growth-competitors';
import { runSeoAudit } from './growth-seo';
import { createTask, getTask, listTasks, systemUpdate, upsertAiTask, type Task } from './growth-tasks';
import { oppTask, propTask, recTask, slug as taskSlug, tasksForAnalyst } from './growth-workspace';
import { MONTHLY_SCHEMA, MONTHLY_SYSTEM, TEXT_SCHEMA, TEXT_SYSTEM, unsupportedNumbers, type MonthlyAi, type TextDraft } from './growth-report';
import { goals as loadGoals } from './growth-goals';
import { spendRows } from './growth-money';
import { liveAnalytics } from './growth-workspace';
import { ANALYST_SYSTEM, analystPrompt, DRAFT_SCHEMA, DRAFT_SYSTEM, FORBIDDEN_CLAIMS, numbersIn, opportunityScore, REPORT_SCHEMA, ruleFindings, validateReport, type AiReport, type DraftResult, type OpenRec, type Opportunity } from './growth-report';
import { log } from './log';
import { teamMembers } from './roles';

const DAY = 86_400_000;
const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const CONSOLE = process.env.CONSOLE_ORIGIN ?? 'https://console.lens.instagrowapp.com';
const STATUSES = ['proposed', 'approved', 'shipped', 'measured', 'kept', 'dropped'] as const;
const OPEN = new Set(['proposed', 'approved', 'shipped', 'measured']);
/** Level-2 tools the owner may switch on (growth-mcp.ts enforces it). */
export const LEVEL2_TOOLS = ['submit_sitemap'] as const;
const TOOL_NAMES = ['search_analytics', 'compare_periods', 'inspect_url', 'list_sitemaps', 'audit_page', 'find_in_code', 'read_code', 'keyword_volume', 'related_keywords', 'topic_interest', 'trending_now', 'ga4_report', 'competitor_page', 'watch_page', 'submit_sitemap', 'propose_change'];
const REPO = 'akshaydhadwal745/lens-camera';
const CODE_DIR = '/tmp/growth-code';
const TOOL_LOG = '/tmp/growth-tools.jsonl';
const KEEP = 400 * 86400;

/** Up to 3 tries with a growing pause: network blips must not cost a week's report. */
async function retry<T>(f: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

// ---------- facts ----------

/** The daily pull marks each fetched day from this date on (search-console.ts). */
const PULL_MARKERS_SINCE = '2026-10-31';

async function searchDays(now: number): Promise<(SearchDay & { pulled: boolean })[]> {
  const days = Array.from({ length: 56 }, (_, i) => new Date(now - (56 - i) * DAY).toISOString().slice(0, 10));
  return Promise.all(
    days.map(async (day) => {
      const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `GSC#${day}` } }));
      const items = (r.Items ?? []) as SearchRow[];
      return { day, rows: items.filter((x) => x.sk !== 'pulled'), pulled: items.some((x) => x.sk === 'pulled') };
    }),
  );
}

export async function collectFacts(now = Date.now()): Promise<{ facts: Fact[]; notes: string[]; indexState: Record<string, string> }> {
  const notes: string[] = [];
  const facts: Fact[] = [];
  facts.push(...searchFacts(await searchDays(now)));
  const coverageState = new Map<string, string>();
  try {
    const coverage = await retry(indexCoverage);
    for (const [path, st] of Object.entries(coverage?.stateOf ?? {})) coverageState.set(path, st);
    if (coverage) facts.push(...indexFacts(coverage));
    else notes.push('Index coverage skipped: the Search Console key is not set up.');
  } catch (e) {
    notes.push(`Index coverage failed: ${(e as Error).message.slice(0, 120)}`);
  }
  facts.push(...productFacts(await compute(30)));
  facts.push(...(await watchFacts(now, coverageState)));
  facts.push(...(await demand(now, notes)));
  facts.push(...(await ga4(notes)));
  return { facts, notes, indexState: Object.fromEntries(coverageState) };
}

/** `items` through `f`, 4 at a time (bursts of connections time out); failures become undefined. */
async function fourAtATime<T, R>(items: readonly T[], f: (x: T) => Promise<R>): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = [];
  for (let i = 0; i < items.length; i += 4) out.push(...(await Promise.all(items.slice(i, i + 4).map((x) => retry(() => f(x), 2).catch(() => undefined)))));
  return out;
}

/** Bing searches (India and US) for the seed keywords, Wikipedia interest, relevant trending searches. */
async function demand(now: number, notes: string[]): Promise<Fact[]> {
  const key = await getParam('/lens/growth/bing-key');
  const pairs = SEED_KEYWORDS.flatMap((k) => (['in', 'us'] as const).map((c) => ({ k, c })));
  const bing = key ? await fourAtATime(pairs, (p) => bingTrend(key, p.k, p.c, now)) : [];
  if (!key) notes.push('Bing keyword data skipped: /lens/growth/bing-key is not set.');
  else if (bing.some((b) => !b)) notes.push(`Bing keyword data: ${bing.filter((b) => !b).length} of ${pairs.length} lookups failed.`);
  const wiki = await fourAtATime(WIKI_ARTICLES, async (a) => wikiTrend(a, await wikiViews(a, now)));
  if (wiki.some((w) => !w)) notes.push(`Wikipedia interest: ${wiki.filter((w) => !w).length} of ${WIKI_ARTICLES.length} articles failed.`);
  const trending = await fourAtATime(['IN', 'US'], async (geo) => {
    const items = await trendingNow(geo);
    return { geo, total: items.length, relevant: items.filter((i) => i.relevant).map((i) => i.title) };
  });
  return demandFacts(
    bing.filter((b): b is NonNullable<typeof b> => !!b),
    wiki.filter((w): w is NonNullable<typeof w> => !!w),
    trending.filter((t): t is NonNullable<typeof t> => !!t),
  );
}

/** GA4: the last 28 days in total and by channel group. Empty until the tag has data. */
async function ga4(notes: string[]): Promise<Fact[]> {
  try {
    const token = await retry(() => googleToken(GA4_SCOPE));
    if (!token) return [];
    const range = [{ startDate: '28daysAgo', endDate: 'yesterday' }];
    const [byChannel, total] = await Promise.all([
      ga4Report(token, { dateRanges: range, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'keyEvents' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }),
      ga4Report(token, { dateRanges: range, metrics: [{ name: 'sessions' }, { name: 'engagementRate' }, { name: 'averageSessionDuration' }] }),
    ]);
    return ga4Facts(byChannel.rows, total.rows[0]);
  } catch (e) {
    notes.push(`GA4 failed: ${(e as Error).message.slice(0, 120)}`);
    return [];
  }
}

/** Watched pages: Search Console clicks and impressions (28 days vs the 28 before) and index state. */
async function watchFacts(now: number, state: Map<string, string>): Promise<Fact[]> {
  const days = await searchDays(now);
  const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'WATCH#' } }));
  const out: Fact[] = [];
  for (const [i, w] of (r.Items ?? []).entries()) {
    const sum = (part: SearchDay[], k: 'clicks' | 'impressions') => part.reduce((s, d) => s + (d.rows.find((x) => x.sk === `p#${w.path}`)?.[k] ?? 0), 0);
    const label = `Watched page ${w.path} (since ${w.since})`;
    out.push(fact({ id: `watch.${i + 1}.impressions`, area: 'search', label: `${label}: impressions`, value: sum(days.slice(-28), 'impressions'), previous: sum(days.slice(-56, -28), 'impressions'), unit: 'count', window: '28 days vs the 28 before' }));
    out.push(fact({ id: `watch.${i + 1}.clicks`, area: 'search', label: `${label}: clicks`, value: sum(days.slice(-28), 'clicks'), previous: sum(days.slice(-56, -28), 'clicks'), unit: 'count', window: '28 days vs the 28 before' }));
    out.push(fact({ id: `watch.${i + 1}.indexed`, area: 'search', label: `${label}: indexed by Google (1 yes, 0 no); state "${state.get(w.path) ?? 'not checked'}"`, value: state.has(w.path) ? (state.get(w.path) === 'Submitted and indexed' ? 1 : 0) : null, unit: 'count', window: 'now' }));
  }
  return out;
}

/** Problems the owner should hear about even when the report itself looks fine. */
async function healthNotes(now: number): Promise<string[]> {
  const notes: string[] = [];
  // Search Console: days the daily pull should have fetched (Google lags ~3 days) but didn't.
  const from = Math.max(Date.parse(PULL_MARKERS_SINCE), now - 28 * DAY);
  const missing: string[] = [];
  for (const d of await searchDays(now)) {
    const t = Date.parse(`${d.day}T00:00:00Z`);
    if (t >= from && t <= now - 4 * DAY && !d.pulled) missing.push(d.day);
  }
  if (missing.length) notes.push(`Search Console data is missing for ${missing.length} day(s) (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}): the daily pull may be failing, and search numbers for those days read as zero.`);
  // The Claude token from `claude setup-token` lasts a year.
  try {
    const p = await new SSMClient({}).send(new GetParameterCommand({ Name: '/lens/growth/claude-token' }));
    const set = p.Parameter?.LastModifiedDate?.getTime();
    if (set) {
      const expires = set + 365 * DAY;
      if (expires - now < 30 * DAY) notes.push(`The Claude token for the analyst expires around ${new Date(expires).toISOString().slice(0, 10)}: run \`claude setup-token\` and replace /lens/growth/claude-token.`);
    }
  } catch (e) {
    console.error('growth token age', e);
  }
  return notes;
}

// ---------- the code the tools may read: the website at the current main commit ----------

const CODE_PATHS = /^(site\/src\/|site\/scripts\/|site\/astro\.config\.mjs$|docs\/growth\/)/;
const TEXT = /\.(ts|tsx|astro|mjs|js|json|md|css)$/;

/** A read-only copy of the SEO-relevant code (public repo; no token needed). Returns the commit. */
export async function fetchCode(): Promise<string> {
  const gh = async (url: string) => {
    const res = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'lens-growth' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`GitHub ${res.status} ${url}`);
    return res.json() as Promise<any>;
  };
  const commit = (await gh(`https://api.github.com/repos/${REPO}/commits/main`)).sha as string;
  const tree = (await gh(`https://api.github.com/repos/${REPO}/git/trees/${commit}?recursive=1`)).tree as { path: string; type: string; size?: number }[];
  const files = tree.filter((t) => t.type === 'blob' && CODE_PATHS.test(t.path) && TEXT.test(t.path) && (t.size ?? 0) < 300_000);
  rmSync(CODE_DIR, { recursive: true, force: true });
  // 4 at a time, each file retried: bursts of new connections can time out.
  for (let i = 0; i < files.length; i += 4)
    await Promise.all(
      files.slice(i, i + 4).map((f) =>
        retry(async () => {
          const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${commit}/${f.path}`, { signal: AbortSignal.timeout(20_000) });
          if (!res.ok) throw new Error(`raw ${res.status} ${f.path}`);
          mkdirSync(dirname(join(CODE_DIR, f.path)), { recursive: true });
          writeFileSync(join(CODE_DIR, f.path), await res.text());
        }),
      ),
    );
  return commit;
}

const readCode = (file: string) => {
  const p = join(CODE_DIR, file);
  return p.startsWith(CODE_DIR) && existsSync(p) ? readFileSync(p, 'utf8') : undefined;
};

async function enabledTools(): Promise<string[]> {
  const r = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'TOOLS' } }))).Item;
  return ((r?.enabled ?? []) as string[]).filter((t) => (LEVEL2_TOOLS as readonly string[]).includes(t));
}

type ToolEntry = { at: number; tool: string; level?: number; args: Record<string, unknown>; ok: boolean; refused?: boolean; error?: string; result?: unknown; ms: number };
const toolLog = (): ToolEntry[] =>
  existsSync(TOOL_LOG)
    ? readFileSync(TOOL_LOG, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as ToolEntry];
          } catch {
            return []; // a line cut short when the time limit killed the run
          }
        })
    : [];

// ---------- the analyst (Claude Code CLI, headless; its only tools are the growth MCP server) ----------

type ToolSetup = { googleToken?: string; writeToken?: string; bingKey?: string; ga4Token?: string; competitorHosts?: string[]; enabled: string[]; commit?: string };

/** What a run asks of Claude: its instructions, output schema and tool list (the weekly report by default). */
type Mode = { system: string; schema: object; toolNames: string[]; mode: 'report' | 'draft' };
const REPORT_MODE: Mode = { system: ANALYST_SYSTEM, schema: REPORT_SCHEMA, toolNames: TOOL_NAMES, mode: 'report' };

function runClaude<T = AiReport>(prompt: string, token: string, tools: ToolSetup, deadline: number, mode: Mode = REPORT_MODE): Promise<{ report: T; model?: string }> {
  const home = '/tmp/claude-home';
  mkdirSync(home, { recursive: true });
  const mcp = join(home, 'mcp.json');
  writeFileSync(
    mcp,
    JSON.stringify({
      mcpServers: {
        growth: {
          type: 'stdio',
          command: process.execPath,
          args: [join(process.env.LAMBDA_TASK_ROOT ?? __dirname, 'mcp.js')],
          env: {
            GROWTH_GOOGLE_TOKEN: tools.googleToken ?? '',
            GROWTH_GOOGLE_WRITE_TOKEN: tools.writeToken ?? '',
            GROWTH_BING_KEY: tools.bingKey ?? '',
            GROWTH_GA4_TOKEN: tools.ga4Token ?? '',
            GROWTH_COMPETITOR_HOSTS: (tools.competitorHosts ?? []).join(','),
            GROWTH_ENABLED_TOOLS: tools.enabled.join(','),
            GROWTH_CODE_DIR: CODE_DIR,
            GROWTH_CODE_COMMIT: tools.commit ?? '',
            GROWTH_TOOL_LOG: TOOL_LOG,
            GROWTH_MODE: mode.mode,
          },
        },
      },
    }),
  );
  const args = [
    '-p',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    mcp,
    '--allowedTools',
    mode.toolNames.map((t) => `mcp__growth__${t}`).join(','),
    '--no-session-persistence',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(mode.schema),
    '--system-prompt',
    mode.system,
    '--model',
    'opus',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_CODE_OAUTH_TOKEN: token, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), Math.max(60_000, deadline - Date.now()));
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out.slice(out.indexOf('{'))) as { is_error?: boolean; result?: string; structured_output?: T; modelUsage?: Record<string, unknown> };
        if (r.is_error || !r.structured_output) throw new Error(String(r.result ?? 'no structured output').slice(0, 200));
        resolve({ report: r.structured_output, model: Object.keys(r.modelUsage ?? {}).find((m) => m.includes('opus') || m.includes('sonnet')) });
      } catch (e) {
        reject(new Error(`claude exited ${code}${code === null ? ' (time limit)' : ''}: ${(e as Error).message} ${err.slice(0, 200)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/** The AI report, checked; one retry with the problems listed. Returns what it got and anything still wrong. */
async function analyst(facts: Fact[], prompt: string, tools: ToolSetup, started: number): Promise<{ ai?: AiReport; aiProblems?: string[]; aiError?: string; model?: string }> {
  const token = await getParam('/lens/growth/claude-token');
  if (!token) return { aiError: 'Claude token not set up (SSM /lens/growth/claude-token).' };
  // The Lambda has 15 minutes: facts take ~1, storing ~1; the analyst gets the rest.
  const deadline = started + 12 * 60_000;
  const check = (r: AiReport) => validateReport(r, facts, numbersIn(toolLog().filter((t) => t.ok).map((t) => t.result)), readCode);
  let first: { report: AiReport; model?: string };
  try {
    first = await runClaude(prompt, token, tools, deadline);
  } catch (e) {
    return { aiError: (e as Error).message.slice(0, 400) };
  }
  let { report, model } = first;
  let problems = check(report);
  if (problems.length && deadline - Date.now() > 5 * 60_000) {
    // A failed retry keeps the first answer (flagged), rather than losing the week's report.
    const second = await runClaude(`${prompt}\n\nYour previous answer broke the rules:\n${problems.map((p) => `- ${p}`).join('\n')}\nFix these: only numbers from cited facts or tool results, only existing fact ids, and code locations copied exactly from tool results.`, token, tools, deadline).catch(() => undefined);
    if (second) {
      const again = check(second.report);
      if (again.length <= problems.length) ({ report, model, problems } = { ...second, problems: again });
    }
  }
  return { ai: report, model, ...(problems.length ? { aiProblems: problems } : {}) };
}

/** Tool calls → activity rows; proposals and watched pages → their own rows. */
async function saveToolActivity(date: string, run: string, now: number) {
  const entries = toolLog();
  for (const [i, t] of entries.entries()) {
    const resultSize = t.result === undefined ? 0 : JSON.stringify(t.result).length;
    await ddb.send(
      new PutCommand({
        TableName: env.table,
        Item: { pk: 'GROWTH', sk: `ACT#${String(t.at).padStart(15, '0')}#${i}`, at: t.at, tool: t.tool, level: t.level, args: t.args, ok: t.ok, refused: !!t.refused, error: t.error, resultSize, ms: t.ms, report: date, ttl: Math.floor(now / 1000) + KEEP },
      }),
    );
    if (!t.ok) continue;
    if (t.tool === 'propose_change') {
      // Only the fields the tool server checked and returned (never the model's raw arguments); keys last.
      const r = t.result as Record<string, unknown>;
      const id = `P-${run}-${i + 1}`;
      const fields = { title: text(r.title, 200), evidence: text(r.evidence, 3000), files: Array.isArray(r.files) ? r.files.map((f) => text(f, 200)).slice(0, 20) : [], change: text(r.change, 3000), validation: text(r.validation, 1000), measurement: text(r.measurement, 1000) };
      await ifNew({ ...fields, status: 'proposed', report: date, createdAt: now, pk: 'GROWTH', sk: `PROP#${id}`, id });
      if (!date.startsWith('draft:')) await upsertAiTask(`prop:${id}`, propTask(fields), date, { kind: 'prop', id, ...fields });
    }
    if (t.tool === 'watch_page') {
      const w = t.result as { watching: string; reason: string };
      if (typeof w?.watching === 'string' && /^\/[\w\-/.]*$/.test(w.watching)) await ifNew({ path: w.watching, reason: text(w.reason, 300), since: date, report: date, pk: 'GROWTH', sk: `WATCH#${w.watching}` });
    }
  }
  return entries.length;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** A row written only if it doesn't exist yet; "already there" is expected, anything else is a real error. */
async function ifNew(item: Record<string, unknown>) {
  await ddb.send(new PutCommand({ TableName: env.table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' })).catch((e) => {
    if (e?.name !== 'ConditionalCheckFailedException') throw e;
  });
}

/** Recommendation fields from the report schema, type-checked and capped; nothing else reaches the ledger row. */
function recFields(r: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (!REC_KEYS.has(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 2000);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').slice(0, 30).map((x) => (x as string).slice(0, 200));
  }
  return out;
}
/** The whole lifecycle; drafting and pr-open are set by the drafting step (Phase C), not the owner. */
export type OppStatus = 'idea' | 'planned' | 'drafting' | 'pr-open' | 'published' | 'measured' | 'rejected';
const OWNER_OPP_STATUSES: OppStatus[] = ['idea', 'planned', 'published', 'measured', 'rejected'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const list = (v: unknown, max: number, len = 200) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max).map((x) => x.slice(0, len)) : []);

/** An opportunity's stored fields: every one named, typed and capped (the model's object is never spread). */
function oppFields(o: Opportunity) {
  const b = (o.brief ?? {}) as Partial<Opportunity['brief']>;
  return {
    topic: text(o.topic, 200),
    targetKeyword: text(o.targetKeyword, 120),
    intent: text(o.intent, 20),
    audience: text(o.audience, 400),
    lensFeatures: list(o.lensFeatures, 8, 80),
    relevance: [0, 1, 2, 3].includes(o.relevance) ? o.relevance : 0,
    relevanceReason: text(o.relevanceReason, 800),
    demand: text(o.demand, 20),
    demandEvidence: text(o.demandEvidence, 1500),
    trend: text(o.trend, 20),
    winnability: text(o.winnability, 20),
    competition: text(o.competition, 800),
    action: text(o.action, 30),
    existingPage: text(o.existingPage, 200),
    brief: {
      url: text(b.url, 200),
      title: text(b.title, 120),
      metaDescription: text(b.metaDescription, 300),
      h1: text(b.h1, 200),
      outline: list(b.outline, 20),
      questions: list(b.questions, 15),
      supportingKeywords: list(b.supportingKeywords, 20, 100),
      internalLinksFrom: list(b.internalLinksFrom, 10),
      internalLinksTo: list(b.internalLinksTo, 10),
      searchResultsToday: text(b.searchResultsToday, 800),
    },
    businessValue: text(o.businessValue, 800),
    measurement: text(o.measurement, 800),
    facts: list(o.facts, 30, 120),
  };
}

/** New ideas join the backlog; known ones get this week's evidence and score, keeping the owner's status. */
async function saveOpportunities(opps: Opportunity[], date: string, now: number) {
  for (const o of opps) {
    const fields = oppFields(o);
    if (!fields.relevance || !fields.targetKeyword) continue;
    const id = slug(fields.targetKeyword);
    const score = opportunityScore(o);
    const key = { pk: 'GROWTH', sk: `OPP#${id}` };
    const old = (await ddb.send(new GetCommand({ TableName: env.table, Key: key }))).Item;
    const history = [...((old?.history as { date: string; score: number }[] | undefined) ?? []).filter((h) => h.date !== date), { date, score }].slice(-26);
    await ddb.send(
      new PutCommand({
        TableName: env.table,
        Item: { ...fields, score, history, status: old?.status ?? 'idea', note: old?.note, firstSeen: old?.firstSeen ?? date, lastSeen: date, updatedAt: now, decidedBy: old?.decidedBy, pr: old?.pr, ...key, id },
      }),
    );
  }
}

const REC_KEYS = new Set(Object.keys((REPORT_SCHEMA as any).properties.recommendations.items.properties as Record<string, unknown>));

// ---------- the run lock (one report at a time: Console button and Monday schedule) ----------

const STALE = 20 * 60_000;

/** Takes the lock unless a run started in the last 20 minutes. Returns its start time, or undefined if busy. */
export async function takeLock(by: string, ai: boolean, now = Date.now()): Promise<number | undefined> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: env.table,
        Item: { pk: 'GROWTH', sk: 'RUNNING', at: now, by, ai },
        ConditionExpression: 'attribute_not_exists(pk) OR #a < :stale',
        ExpressionAttributeNames: { '#a': 'at' },
        ExpressionAttributeValues: { ':stale': now - STALE },
      }),
    );
    return now;
  } catch (e) {
    if ((e as { name?: string })?.name === 'ConditionalCheckFailedException') return undefined;
    throw e;
  }
}

async function releaseLock(at: number, error?: string) {
  await ddb
    .send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: 'GROWTH', sk: 'RUNNING' },
        UpdateExpression: error ? 'SET #a = :z, lastError = :e, lastErrorAt = :t' : 'SET #a = :z REMOVE lastError, lastErrorAt',
        ConditionExpression: '#a = :mine',
        ExpressionAttributeNames: { '#a': 'at' },
        ExpressionAttributeValues: { ':z': 0, ':mine': at, ...(error ? { ':e': error.slice(0, 400), ':t': Date.now() } : {}) },
      }),
    )
    .catch((e) => console.error('growth lock release', e));
}

// ---------- recommendations ledger ----------

async function recs(): Promise<Record<string, any>[]> {
  const r = await ddb.send(
    new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'REC#' }, ScanIndexForward: false }),
  );
  return r.Items ?? [];
}

// ---------- the weekly run (GrowthAnalyst Lambda) ----------

export async function runGrowthReport(opts: { ai: boolean; by: string; lockAt?: number }) {
  // The Console takes the lock before invoking; the schedule takes it here.
  const lockAt = opts.lockAt ?? (await takeLock(opts.by, opts.ai));
  if (lockAt === undefined) {
    console.log('growth report skipped: another run is in progress');
    return { skipped: true };
  }
  try {
    const result = await report(opts);
    await releaseLock(lockAt);
    return result;
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error('growth report failed', e);
    await releaseLock(lockAt, message);
    await emailFailure(message).catch((err) => console.error('growth failure email', err));
    throw e;
  }
}

async function report(opts: { ai: boolean; by: string }) {
  const now = Date.now();
  await syncPullRequests().catch((e) => console.error('growth PR sync', e));
  const date = new Date(now).toISOString().slice(0, 10);
  // Unique per run, so a second run on the same day never collides with the first one's ids.
  const run = `${date}-${new Date(now).toISOString().slice(11, 16).replace(':', '')}`;
  const { facts, notes, indexState } = await collectFacts(now);
  // SEO audit (every sitemap page, speed, backlinks) with Google's index state; its headline numbers become facts.
  try {
    const seo = await runSeoAudit(now, indexState);
    facts.push(
      fact({ id: 'seo.audit_score', area: 'search', label: 'Technical SEO health score (100 = no issues; −10 per error, −3 per warning per page)', value: seo.score, unit: 'count', window: 'this week' }),
      fact({ id: 'seo.audit_errors', area: 'search', label: 'Technical SEO errors across sitemap pages', value: seo.errors, unit: 'count', window: 'this week' }),
      fact({ id: 'seo.audit_warnings', area: 'search', label: 'Technical SEO warnings across sitemap pages', value: seo.warnings, unit: 'count', window: 'this week' }),
      fact({ id: 'seo.broken_links', area: 'search', label: 'Broken internal links', value: seo.brokenLinks, unit: 'count', window: 'this week' }),
      fact({ id: 'seo.backlinks', area: 'search', label: 'Links to the site found by Bing', value: seo.backlinks, unit: 'count', window: 'this week' }),
    );
  } catch (e) {
    notes.push(`SEO audit failed: ${(e as Error).message.slice(0, 120)}`);
  }
  // Competitors: what changed on their sites this week (the agent can read their pages with competitor_page).
  try {
    for (const c of await watchCompetitors(now)) {
      const key = taskSlug(c.name);
      if (c.changes.length) facts.push(fact({ id: `comp.${key}.changes`, area: 'competitors', label: `${c.name}: changes on its homepage this week (${c.changes.join(' | ').slice(0, 300)})`, value: c.changes.length, unit: 'count', window: 'since last week' }));
      if (c.newPages.length) facts.push(fact({ id: `comp.${key}.new_pages`, area: 'competitors', label: `${c.name}: new pages in its sitemap (${c.newPages.slice(0, 5).join(', ')})`, value: c.newPages.length, unit: 'count', window: 'since last week' }));
    }
  } catch (e) {
    notes.push(`Competitor watch failed: ${(e as Error).message.slice(0, 120)}`);
  }
  const rules = ruleFindings(facts);
  // The analyst reviews the workspace's tasks (open, and finished in the last 45 days), not the old ledger.
  const open: OpenRec[] = await tasksForAnalyst();
  let ai: Awaited<ReturnType<typeof analyst>> = {};
  let commit: string | undefined;
  let toolCalls = 0;
  if (opts.ai) {
    rmSync(TOOL_LOG, { force: true });
    commit = await fetchCode().catch((e) => {
      notes.push(`Code copy failed: ${(e as Error).message.slice(0, 120)}`);
      return undefined;
    });
    const enabled = await enabledTools();
    const tools: ToolSetup = {
      googleToken: await retry(() => googleToken()).catch(() => undefined),
      writeToken: enabled.includes('submit_sitemap') ? await retry(() => googleToken('https://www.googleapis.com/auth/webmasters')).catch(() => undefined) : undefined,
      bingKey: await getParam('/lens/growth/bing-key').catch(() => undefined),
      ga4Token: await retry(() => googleToken(GA4_SCOPE)).catch(() => undefined),
      competitorHosts: await competitorHosts().catch(() => []),
      enabled,
      commit,
    };
    ai = await analyst(facts, analystPrompt(facts, rules, open), tools, now);
    toolCalls = await saveToolActivity(date, run, now);
  }
  const held = !!ai.aiProblems?.length;
  if (held) notes.push('Recommendations were held back from the ledger because the report failed its number checks.');
  notes.push(...(await healthNotes(now)));
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...ai, date, at: now, by: opts.by, facts, rules, notes, commit, toolCalls, pk: 'GROWTH', sk: `REPORT#${date}` } }));
  // New recommendations join the ledger as "proposed", but only from a report that passed the checks;
  // a re-run the same day replaces that day's still-untouched ones.
  if (ai.ai && !held) {
    for (const old of await recs())
      if (old.report === date && old.status === 'proposed')
        await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: old.sk }, UpdateExpression: 'SET #s = :d, note = :n, updatedAt = :t', ConditionExpression: '#s = :p', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':d': 'dropped', ':n': 'Replaced by a later report the same day.', ':t': now, ':p': 'proposed' } })).catch((e) => {
          if (e?.name !== 'ConditionalCheckFailedException') throw e;
        });
    await saveOpportunities(ai.ai.opportunities ?? [], date, now);
    // Everything the agent suggests becomes a Suggested task in the workspace (deduped across weeks).
    for (const o of ai.ai.opportunities ?? []) {
      const f = oppFields(o);
      if (!f.relevance || !f.targetKeyword) continue;
      const id = slug(f.targetKeyword);
      await upsertAiTask(`opp:${id}`, oppTask(f, opportunityScore(o)), date, { kind: 'opp', id, ...f, score: opportunityScore(o) });
    }
    for (const rec of ai.ai.recommendations ?? []) await upsertAiTask(`rec:${taskSlug(rec.title)}`, recTask(rec), date);
    for (const [i, rec] of (ai.ai.recommendations ?? []).entries()) {
      const id = `R-${run}-${i + 1}`;
      await ifNew({ ...recFields(rec as Record<string, unknown>), status: 'proposed', report: date, createdAt: date, updatedAt: now, pk: 'GROWTH', sk: `REC#${id}`, id });
    }
  }
  await emailOwners(date, rules.length, ai, notes).catch((e) => console.error('growth email', e));
  console.log('growth report', JSON.stringify({ date, facts: facts.length, rules: rules.length, ai: !!ai.ai, aiProblems: ai.aiProblems?.length ?? 0, aiError: ai.aiError }));
  return { date, facts: facts.length, rules: rules.length, ai: !!ai.ai, aiError: ai.aiError };
}

async function emailOwners(date: string, rules: number, ai: { ai?: AiReport; aiError?: string }, notes: string[]) {
  const body = [
    ai.ai ? ai.ai.summary : `This week's report has ${rules} rule-based findings.${ai.aiError ? ` The AI analysis did not run: ${ai.aiError}` : ''}`,
    '',
    ...(ai.ai?.recommendations ?? []).map((r, i) => `${i + 1}. ${r.title}`),
    ...(notes.length ? ['', 'Needs attention:', ...notes.map((n) => `- ${n}`)] : []),
    '',
    `Full report: ${CONSOLE}/growth`,
  ].join('\n');
  await sendToOwners(`Lens growth report · ${date}`, body);
}

async function emailFailure(message: string) {
  await sendToOwners('Lens growth report failed', `This week's growth report stopped with an error:\n\n${message.slice(0, 600)}\n\nYou can try again from ${CONSOLE}/growth (Run report now).`);
}

/** Owners only. Throws when it can't send, so a missing sender or owner list shows up in the logs. */
async function sendToOwners(subject: string, body: string) {
  const sender = process.env.CODE_SENDER ?? '';
  const to = (await teamMembers()).filter((m) => m.role === 'owner').map((m) => m.email);
  if (!sender.startsWith('no-reply@')) throw new Error(`growth email: no sender configured (${sender || 'empty'})`);
  if (!to.length) throw new Error('growth email: no owners in the team');
  await new SESv2Client({}).send(
    new SendEmailCommand({
      FromEmailAddress: `Lens Console <${sender}>`,
      Destination: { ToAddresses: to },
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } },
    }),
  );
}

// ---------- drafts (Phase C): a task becomes a pull request ----------

const DRAFT_TOOLS = ['find_in_code', 'read_code', 'audit_page', 'edit_file'];
const DRAFT_MODE: Mode = { system: DRAFT_SYSTEM, schema: DRAFT_SCHEMA, toolNames: DRAFT_TOOLS, mode: 'draft' };
const ORIG_DIR = '/tmp/growth-code-orig';

const walk = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)])) : [];

/** Files the draft changed, compared with the untouched copy. */
function changedFiles(): { path: string; content: string; before: string }[] {
  return walk(CODE_DIR)
    .map((abs) => {
      const path = relative(CODE_DIR, abs);
      const before = existsSync(join(ORIG_DIR, path)) ? readFileSync(join(ORIG_DIR, path), 'utf8') : '';
      return { path, content: readFileSync(abs, 'utf8'), before };
    })
    .filter((f) => f.content !== f.before);
}

/** Problems that stop a draft before it reaches GitHub (checked by code, not by the model). */
export function draftProblems(files: { path: string; content: string; before: string }[]): string[] {
  const out: string[] = [];
  if (!files.length) out.push('the draft changed nothing');
  if (files.length > 10) out.push(`the draft changed ${files.length} files (max 10)`);
  for (const f of files) {
    if (!EDITABLE.test(f.path)) out.push(`${f.path} is outside what drafts may change`);
    const count = (t: string) => (t.match(new RegExp(FORBIDDEN_CLAIMS, 'gi')) ?? []).length;
    if (count(f.content) > count(f.before)) out.push(`${f.path} adds a claim product-facts.md forbids (unlimited / free forever)`);
  }
  return out;
}

/** The instructions for Claude, from the task's stored (checked) fields and its brief or change, if any. */
function draftTask(t: Task): string {
  const s = (t.spec ?? {}) as Record<string, any>;
  if (s.kind === 'prop')
    return `APPROVED CODE CHANGE (task ${t.id})\nTitle: ${s.title}\nEvidence: ${s.evidence}\nFiles: ${(s.files ?? []).join(', ')}\nChange: ${s.change}\nValidation: ${s.validation ?? ''}\nMeasurement: ${s.measurement}`;
  if (s.kind === 'opp') {
    const b = s.brief ?? {};
    return [
      `APPROVED CONTENT OPPORTUNITY (task ${t.id}; action: ${s.action}${s.existingPage ? `, existing page ${s.existingPage}` : ''})`,
      `Topic: ${s.topic}. Target keyword: "${s.targetKeyword}" (${s.intent}). Audience: ${s.audience}`,
      `Why: ${s.relevanceReason} Demand: ${s.demandEvidence} Competition: ${s.competition}`,
      `Lens features to show: ${(s.lensFeatures ?? []).join(', ')}`,
      `Brief: URL ${b.url}; title "${b.title}"; meta description "${b.metaDescription}"; H1 "${b.h1}"`,
      `Outline: ${(b.outline ?? []).join(' | ')}`,
      `Questions to answer: ${(b.questions ?? []).join(' | ')}`,
      `Supporting keywords: ${(b.supportingKeywords ?? []).join(', ')}`,
      `Internal links from: ${(b.internalLinksFrom ?? []).join(', ')}; to: ${(b.internalLinksTo ?? []).join(', ')}`,
    ].join('\n');
  }
  if (s.kind === 'competitor')
    return `COMPETITOR RESEARCH (task ${t.id}): ${s.name} (${s.site}).\nRead their homepage, pricing and feature pages with competitor_page (start from ${s.site}; follow links you see in the text), and our own pages (audit_page) and docs/growth/product-facts.md. ${t.description}`;
  // A task written by a person: the title, description, evidence and page are the brief.
  return [`APPROVED TASK ${t.id}: ${t.title}`, t.description, t.evidence.length ? `Evidence: ${t.evidence.map((e) => e.text).join(' | ')}` : '', t.links.page ? `Page: ${t.links.page}` : '', t.links.keyword ? `Keyword: ${t.links.keyword}` : '', t.metric.label ? `Success metric: ${t.metric.label}` : '']
    .filter(Boolean)
    .join('\n');
}

function prBody(t: Task, d: DraftResult, by: string, commit: string) {
  return [
    `Drafted by the Lens growth agent for task **${t.id}: ${t.title}**, requested by ${by} in Lens Console (${CONSOLE}/growth/tasks?task=${t.id}).`,
    '',
    '## What changed',
    d.summary,
    '',
    ...d.changes.map((c) => `- \`${c.file}\`: ${c.what}`),
    '',
    '## Why',
    ...t.evidence.map((e) => `- ${e.text}`),
    t.metric.label ? `\n**Measure:** ${t.metric.label}${t.metric.checkOn ? ` (check on ${t.metric.checkOn})` : ''}` : '',
    '',
    '## Check before merging',
    ...d.checks.map((c) => `- [ ] ${c}`),
    '',
    `**Risks:** ${d.risks}`,
    '',
    `Based on main at ${commit.slice(0, 7)}. The agent can't merge: review, approve and merge yourself (CI builds the site and runs the SEO check).`,
  ].join('\n');
}

/** Tasks the agent drafts as text for a person to post or send (no code change, no PR). */
export const TEXT_TYPES = ['social', 'listing', 'partner', 'research'];
const TEXT_MODE: Mode = { system: TEXT_SYSTEM, schema: TEXT_SCHEMA, toolNames: ['find_in_code', 'read_code', 'audit_page', 'competitor_page'], mode: 'report' };
const CHANNEL_OK = new Set(['instagram', 'youtube', 'reddit', 'whatsapp', 'linkedin', 'x', 'facebook', 'blog', 'other']);

/** Text drafts: posts land in the calendar as "drafted"; listing and outreach text goes on the task. */
async function runTextDraft(t: Task, by: string, started: number) {
  const token = await getParam('/lens/growth/claude-token');
  if (!token) throw new Error('Claude token not set up');
  rmSync(TOOL_LOG, { force: true });
  const commit = await fetchCode();
  const tools: ToolSetup = { googleToken: await retry(() => googleToken()).catch(() => undefined), competitorHosts: await competitorHosts().catch(() => []), enabled: [], commit };
  const { report: d } = await runClaude<TextDraft>(draftTask(t), token, tools, started + 12 * 60_000, TEXT_MODE);
  await saveToolActivity(`draft:${t.id}`, `D-${t.id}`, Date.now());
  const drafts = (d.drafts ?? []).filter((x) => typeof x.body === 'string' && x.body.trim()).slice(0, 8);
  if (!drafts.length) throw new Error(`No drafts. Agent said: ${String(d.notes ?? '').slice(0, 300)}`);
  const problems = drafts.filter((x) => new RegExp(FORBIDDEN_CLAIMS, 'i').test(`${x.title} ${x.body}`)).map((x) => x.title);
  if (problems.length) throw new Error(`Drafts made a claim product-facts.md forbids (unlimited / free forever): ${problems.join(', ')}`);
  let posts = 0;
  for (const x of drafts.filter((y) => y.kind === 'social-post' && CHANNEL_OK.has(y.channel))) {
    const date = new Date(started + Math.max(0, Math.min(14, Math.round(x.dayOffset || 0))) * DAY).toISOString().slice(0, 10);
    const code = `${taskSlug(x.title || x.channel).slice(0, 30) || 'post'}-${Math.random().toString(16).slice(2, 6)}`;
    const page = /^\/[\w\-/]*$/.test(x.page) ? x.page : '/';
    const id = randomUUID().replace(/-/g, '').slice(0, 10);
    await ddb.send(new PutCommand({ TableName: env.table, Item: { channel: x.channel, date, title: text(x.title, 160), body: text(x.body, 5000), status: 'drafted', url: '', page, owner: t.owner === 'agent' ? '' : t.owner, taskId: t.id, code, link: `https://lens.instagrowapp.com${page}?utm_source=${x.channel}&utm_medium=social&utm_campaign=${code}`, createdAt: Date.now(), createdBy: 'agent', updatedAt: Date.now(), pk: 'GROWTH', sk: `POST#${id}`, id } }));
    posts++;
  }
  const rest = drafts.filter((y) => y.kind !== 'social-post' || !CHANNEL_OK.has(y.channel));
  const note = [posts ? `${posts} post draft${posts > 1 ? 's' : ''} added to the social calendar as "drafted".` : '', ...rest.map((x, i) => `Option ${i + 1} · ${x.channel} · ${x.title}\n${x.body}`), d.notes ? `Notes: ${d.notes}` : ''].filter(Boolean).join('\n\n');
  // A competitor brief is kept on the competitor too, so the Competitors page shows the latest one.
  const spec = (t.spec ?? {}) as Record<string, unknown>;
  if (spec.kind === 'competitor' && typeof spec.id === 'string' && /^[a-f0-9]{10}$/.test(spec.id)) {
    const brief = drafts.map((x) => `${x.title}\n\n${x.body}`).join('\n\n');
    await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `COMPETITOR#${spec.id}` }, UpdateExpression: 'SET brief = :b, briefAt = :t, briefTask = :k', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':b': brief.slice(0, 20_000), ':t': Date.now(), ':k': t.id } })).catch((e) => console.error('competitor brief', e));
  }
  const reviewer = t.reviewer || (by.includes('@') ? by : '');
  await systemUpdate(t.id, { status: 'in_review', reviewer, spec: { ...(t.spec ?? {}), drafts } }, `Drafts ready for review:\n\n${note.slice(0, 6000)}`);
  await sendToOwners(`Drafts ready for review: ${t.title.slice(0, 80)}`, `${note.slice(0, 3000)}\n\nReview: ${CONSOLE}/growth/tasks?task=${t.id}\n\nNothing is posted or sent: a person does that.`).catch(() => {});
  return { drafts: drafts.length };
}

/** The draft run (GrowthAnalyst Lambda): fresh code copy → Claude edits it → checks → PR → task In review. */
export async function runDraft(opts: { taskId: string; by: string; lockAt?: number }) {
  const lockAt = opts.lockAt ?? (await takeLock(`draft:${opts.by}`, true));
  if (lockAt === undefined) return { skipped: true };
  const started = Date.now();
  const id = opts.taskId;
  try {
    const t = await getTask(id);
    if (!t || !['ready', 'in_progress'].includes(t.status)) throw new Error(`${id} is not ready to draft`);
    if (TEXT_TYPES.includes(t.type)) {
      await systemUpdate(id, { status: 'in_progress' }, 'The growth agent started drafting text for review');
      const r = await runTextDraft(t, opts.by, started);
      await releaseLock(lockAt);
      return r;
    }
    if (!['page', 'content', 'fix'].includes(t.type) && !t.spec) throw new Error('The agent drafts website changes (page, content or fix tasks) and text (social, listing, partner tasks)');
    await systemUpdate(id, { status: 'in_progress' }, 'The growth agent started drafting a pull request');
    const token = await getParam('/lens/growth/claude-token');
    if (!token) throw new Error('Claude token not set up');
    rmSync(TOOL_LOG, { force: true });
    const commit = await fetchCode();
    rmSync(ORIG_DIR, { recursive: true, force: true });
    cpSync(CODE_DIR, ORIG_DIR, { recursive: true });
    const tools: ToolSetup = { googleToken: await retry(() => googleToken()).catch(() => undefined), enabled: [], commit };
    const { report: d } = await runClaude<DraftResult>(draftTask(t), token, tools, started + 12 * 60_000, DRAFT_MODE);
    await saveToolActivity(`draft:${id}`, `D-${id}`, Date.now());
    const files = changedFiles();
    const problems = draftProblems(files);
    if (problems.length) throw new Error(`${problems.join('; ')}${files.length ? '' : `. Agent said: ${d.summary.slice(0, 300)}`}`);
    const branch = `agent/${id.toLowerCase()}-${taskSlug(t.title).slice(0, 40)}`.replace(/-+$/, '') + `-${new Date(started).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
    const pr = await openPullRequest({ token: await installationToken(), base: commit, branch, files: files.map(({ path, content }) => ({ path, content })), title: d.prTitle.slice(0, 120), body: prBody(t, d, opts.by, commit) });
    const reviewer = t.reviewer || (opts.by.includes('@') ? opts.by : '');
    await systemUpdate(id, { status: 'in_review', reviewer, links: { ...t.links, pr: { url: pr.url, number: pr.number } }, proof: pr.url }, `Pull request opened: ${pr.url}\n\n${d.summary.slice(0, 1500)}`);
    await sendToOwners(`Review the growth agent's pull request: ${d.prTitle.slice(0, 80)}`, `Task ${id}: ${t.title}\n\n${d.summary}\n\nReview, approve and merge: ${pr.url}\nTask: ${CONSOLE}/growth/tasks?task=${id}\n\nNothing changes on the website until you merge.`).catch((e) => console.error('draft email', e));
    await releaseLock(lockAt);
    return { pr: pr.url };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error('growth draft failed', e);
    await systemUpdate(id, { status: 'ready' }, `Draft stopped: ${message.slice(0, 600)}`).catch(() => {});
    await releaseLock(lockAt, `Draft ${id}: ${message}`);
    await sendToOwners('Lens growth agent could not draft a change', `Task ${id} stopped:\n\n${message.slice(0, 600)}\n\nTry again from ${CONSOLE}/growth/tasks?task=${id}`).catch(() => {});
    return { error: message };
  }
}

/** Agent PRs on tasks In review: merged → Done (measuring starts); closed unmerged → back to Ready. */
async function syncPullRequests() {
  for (const t of (await listTasks()).filter((x) => x.status === 'in_review' && typeof x.links?.pr?.number === 'number')) {
    const state = await pullRequestState(t.links.pr!.number).catch(() => 'open' as const);
    if (state === 'merged') await systemUpdate(t.id, { status: 'done', doneAt: Date.now(), proof: `Merged: ${t.links.pr!.url}` }, `Pull request #${t.links.pr!.number} merged: published. Measuring until ${t.metric.checkOn || 'the check date'}.`);
    if (state === 'closed') await systemUpdate(t.id, { status: 'ready' }, `Pull request #${t.links.pr!.number} was closed without merging`);
  }
}

/** Starts a draft now if nothing else is running (Console). The Console can't read the GitHub key
 * (least privilege): the draft run checks it and reports a missing setup on the task. */
async function startDraft(taskId: string, email: string): Promise<'started' | 'busy' | 'not-set-up'> {
  if (!process.env.GROWTH_FUNCTION) return 'not-set-up';
  const lockAt = await takeLock(`draft:${email}`, true);
  if (lockAt === undefined) return 'busy';
  await new LambdaClient({})
    .send(new InvokeCommand({ FunctionName: process.env.GROWTH_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ draft: { taskId }, by: email, lockAt })) }))
    .catch(async (e) => {
      await releaseLock(lockAt, `Could not start the draft: ${(e as Error).message}`);
      throw e;
    });
  return 'started';
}

/** POST /growth/competitors/<id>/research: a research task for the agent, drafted right away. */
export async function competitorResearch(id: string, email: string): Promise<Res> {
  const c = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `COMPETITOR#${id}` } }))).Item;
  if (!c) throw new HttpError(404, 'No such competitor');
  const t = await createTask(
    {
      title: `Competitor brief: ${c.name}`,
      description: 'Positioning, pricing and plans, key features, who it is for, strengths, weaknesses, what Lens should learn from it, and where Lens wins (with quotes from their pages).',
      workstream: 'search',
      type: 'research',
      impact: 2,
      confidence: 3,
      effortHours: 1,
      owner: 'agent',
      reviewer: email,
      status: 'ready',
    },
    email,
    { kind: 'person', by: email },
    { kind: 'competitor', id, name: c.name, site: c.site },
  );
  const started = await startDraft(t.id, email).catch(() => 'busy' as const);
  await log({ entity: `growth:competitor:${id}`, action: 'growth.competitor-research', actor: `console:${email}`, data: { task: t.id, started } });
  return json(202, { taskId: t.id, started });
}

/** POST /growth/competitors/check: snapshot every competitor now (GrowthAnalyst). */
export async function competitorCheck(email: string): Promise<Res> {
  if (!process.env.GROWTH_FUNCTION) throw new HttpError(503, 'The growth analyst is not deployed');
  await rateLimit('console-competitor-check', 6, 'A check was started recently. Try again in an hour.');
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.GROWTH_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ competitors: true, by: email })) }));
  return json(202, { started: true });
}

/** POST /growth/seo/audit: run the SEO audit now (GrowthAnalyst; a minute or two). */
export async function seoAuditRun(email: string): Promise<Res> {
  if (!process.env.GROWTH_FUNCTION) throw new HttpError(503, 'The growth analyst is not deployed');
  await rateLimit('console-seo-audit', 6, 'An audit was started recently. Try again in an hour.');
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.GROWTH_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ seoAudit: true, by: email })) }));
  await log({ entity: 'growth:seo', action: 'growth.seo-audit', actor: `console:${email}` });
  return json(202, { started: true });
}

/** POST /growth/tasks/<id>/draft: the agent drafts this task as a pull request. */
export async function growthDraft(taskId: string, email: string): Promise<Res> {
  const t = await getTask(taskId);
  if (!t) throw new HttpError(404, 'No such task');
  if (!['ready', 'in_progress'].includes(t.status)) throw new HttpError(409, 'Accept the task first (only Ready or In progress tasks can be drafted)');
  if (![...TEXT_TYPES, 'page', 'content', 'fix'].includes(t.type) && !t.spec) throw new HttpError(400, 'The agent drafts website changes (page, content, fix) and text (social, listing, partner)');
  const result = await startDraft(taskId, email);
  if (result === 'busy') throw new HttpError(409, 'The analyst is busy (a report or another draft). Try again in about 10 minutes.');
  if (result === 'not-set-up') throw new HttpError(503, 'The growth analyst is not deployed');
  await log({ entity: `growth:task:${taskId}`, action: 'growth.draft-start', actor: `console:${email}` });
  return json(202, { started: true });
}

// ---------- Console routes ----------

/** GET /growth[?date=YYYY-MM-DD]: a report (latest by default), the list of reports and the ledger. */
export async function growthPage(req: Req): Promise<Res> {
  const list = await ddb.send(
    new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'REPORT#' }, ScanIndexForward: false, Limit: 26, ProjectionExpression: '#d, #a', ExpressionAttributeNames: { '#d': 'date', '#a': 'at' } }),
  );
  const dates = (list.Items ?? []).map((i) => i.date as string);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date ?? '') ? req.query.date! : dates[0];
  const report = date ? (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `REPORT#${date}` } }))).Item : undefined;
  const running = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'RUNNING' } }))).Item;
  const rows = async (prefix: string, limit?: number) =>
    (await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': prefix }, ScanIndexForward: false, ...(limit ? { Limit: limit } : {}) }))).Items ?? [];
  const [proposals, watching, activity, opportunities] = await Promise.all([rows('PROP#'), rows('WATCH#'), rows('ACT#', 80), rows('OPP#')]);
  return json(200, {
    dates,
    report: report ?? null,
    recommendations: await recs(),
    proposals,
    opportunities: opportunities.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    watching,
    activity,
    tools: { available: LEVEL2_TOOLS, enabled: await enabledTools() },
    running: running && Date.now() - running.at < STALE ? running : null,
    lastError: running?.lastError ? { message: running.lastError, at: running.lastErrorAt } : null,
  });
}

/** POST /growth/run {ai?: boolean}: a fresh report now (async; takes a few minutes). */
export async function growthRun(req: Req, email: string): Promise<Res> {
  if (!process.env.GROWTH_FUNCTION) throw new HttpError(503, 'The growth analyst is not deployed');
  await rateLimit('console-growth-run', 4, 'A report was started recently. Try again in an hour.');
  const ai = req.body?.ai !== false;
  const lockAt = await takeLock(email, ai);
  if (lockAt === undefined) throw new HttpError(409, 'A report is already running. It takes about 10 minutes.');
  await new LambdaClient({})
    .send(new InvokeCommand({ FunctionName: process.env.GROWTH_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ growth: true, ai, by: email, lockAt })) }))
    .catch(async (e) => {
      await releaseLock(lockAt, `Could not start the report: ${(e as Error).message}`);
      throw e;
    });
  await log({ entity: 'growth:report', action: 'growth.report-run', actor: `console:${email}`, data: { ai } });
  return json(202, { started: true });
}




/** PUT /growth/tools {enabled: [...]}: which level-2 tools the analyst may use. */
export async function growthTools(req: Req, email: string): Promise<Res> {
  const enabled = Array.isArray(req.body?.enabled) ? (req.body.enabled as unknown[]).filter((t): t is string => typeof t === 'string' && (LEVEL2_TOOLS as readonly string[]).includes(t)) : null;
  if (!enabled) throw new HttpError(400, 'enabled must be a list of tool names');
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'TOOLS', enabled, updatedAt: Date.now(), updatedBy: email } }));
  await log({ entity: 'growth:tools', action: 'growth.tools-set', actor: `console:${email}`, data: { enabled } });
  return json(200, { enabled });
}

/** DELETE /growth/watch {path}: stop following a page. */
export async function growthUnwatch(req: Req, email: string): Promise<Res> {
  const path = typeof req.body?.path === 'string' ? req.body.path : '';
  if (!/^\/[\w\-/.]*$/.test(path)) throw new HttpError(400, 'path required');
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `WATCH#${path}` } }));
  await log({ entity: `growth:watch:${path}`, action: 'growth.unwatch', actor: `console:${email}` });
  return json(200, { ok: true });
}


// ---------- the monthly review (1st of each month, and on demand) ----------

const MONTHLY_MODE: Mode = { system: MONTHLY_SYSTEM, schema: MONTHLY_SCHEMA, toolNames: ['read_code'], mode: 'report' };
const prevMonth = (now: number) => {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
};

/** The month's numbers and lists, computed by code (the AI only writes them up). */
export async function monthlyData(month: string) {
  const [y, m] = month.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 1);
  const inMonth = (t?: number) => typeof t === 'number' && t >= start && t < end;
  const tasks = await listTasks();
  const done = tasks.filter((t) => inMonth(t.doneAt));
  const measured = tasks.filter((t) => inMonth(t.measuredAt) && t.result);
  const created = tasks.filter((t) => inMonth(t.createdAt));
  const reports = ((await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': `REPORT#${month}` } }))).Items ?? []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const lastFacts = ((reports[reports.length - 1]?.facts ?? []) as Fact[]).filter((f) => f.value !== null);
  const spend = (await spendRows()).filter((s) => String(s.date).startsWith(month));
  const spendTotal = spend.reduce((a, s) => a + Number(s.amount ?? 0), 0);
  const analytics = await liveAnalytics().catch(() => undefined);
  const mon = (analytics?.installsByMonth as { month: string; installs: number; backedUp: number; paying: number }[] | undefined)?.find((x) => x.month === month);
  const seo = ((await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': `SEOHIST#${month}` } }))).Items ?? []).sort((a, b) => String(a.sk).localeCompare(String(b.sk)));
  const comp = ((await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'COMPSNAP#' } }))).Items ?? []).filter((s) => String(s.sk).includes(`#${month}-`)).filter((s) => (s.changes?.length ?? 0) + (s.newPages?.length ?? 0) > 0);
  const goals = await loadGoals();
  const factOf = (id: string, label: string, value: number | null, unit: Fact['unit'] = 'count') => fact({ id, area: 'app', label, value, unit, window: month });
  const facts: Fact[] = [
    ...lastFacts,
    factOf('month.installs', 'Installs this month', mon?.installs ?? null),
    factOf('month.backed_up', 'Installs this month that backed up', mon?.backedUp ?? null),
    factOf('month.paying', 'Installs this month now paying', mon?.paying ?? null),
    factOf('month.spend', 'Spend this month (₹)', spendTotal),
    factOf('month.cac', 'Cost per install this month (₹)', mon?.installs ? Math.round((spendTotal / mon.installs) * 100) / 100 : null),
    factOf('month.tasks_done', 'Tasks finished this month', done.length),
    factOf('month.results', 'Results measured this month', measured.length),
    factOf('month.worked', 'Measured results that worked', measured.filter((t) => t.result?.verdict === 'worked').length),
    factOf('month.tasks_created', 'Tasks created this month', created.length),
    factOf('month.open', 'Open tasks now', tasks.filter((t) => ['ready', 'in_progress', 'in_review', 'blocked'].includes(t.status)).length),
    factOf('month.blocked', 'Blocked tasks now', tasks.filter((t) => t.status === 'blocked').length),
    factOf('month.seo_score_start', 'SEO health at the start of the month', seo[0]?.score ?? null),
    factOf('month.seo_score_end', 'SEO health at the end of the month', seo[seo.length - 1]?.score ?? null),
    factOf('month.competitor_changes', 'Competitor website changes noticed', comp.length),
  ];
  return {
    month,
    facts,
    done: done.map((t) => ({ id: t.id, title: t.title, workstream: t.workstream })),
    measured: measured.map((t) => ({ id: t.id, title: t.title, verdict: t.result!.verdict, value: t.result!.value })),
    goals: goals.map((g) => ({ id: g.id, title: g.title, krs: g.krs.map((k) => ({ label: k.label, target: k.target, value: k.source === 'manual' ? (k.value ?? null) : (lastFacts.find((f) => f.id === k.fact)?.value ?? null) })) })),
    spendByCategory: spend.reduce<Record<string, number>>((a, s) => ((a[String(s.category)] = (a[String(s.category)] ?? 0) + Number(s.amount ?? 0)), a), {}),
    weekly: reports.map((r) => ({ date: r.date, summary: String(r.ai?.summary ?? '').slice(0, 1200) })),
    competitors: comp.map((c) => ({ snap: String(c.sk), changes: c.changes, newPages: (c.newPages ?? []).length })),
  };
}

/** Builds, writes up (checked) and stores the month-in-review; emails the owners. */
export async function runMonthly(opts: { month?: string; by: string; lockAt?: number }) {
  const lockAt = opts.lockAt ?? (await takeLock(`monthly:${opts.by}`, true));
  if (lockAt === undefined) return { skipped: true };
  const now = Date.now();
  const month = opts.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : prevMonth(now);
  try {
    const data = await monthlyData(month);
    let ai: MonthlyAi | undefined;
    let aiError: string | undefined;
    let aiProblems: string[] = [];
    const token = await getParam('/lens/growth/claude-token');
    if (token) {
      try {
        const prompt = `MONTH: ${month}\n\nMONTH FACTS:\n${data.facts.map((f) => `${f.id} | ${f.label} | ${f.value}${f.unit === 'pct' ? ' (fraction)' : ''} | ${f.window}`).join('\n')}\n\nFINISHED:\n${data.done.map((t) => `${t.id} ${t.title} (${t.workstream})`).join('\n') || 'none'}\n\nMEASURED RESULTS:\n${data.measured.map((t) => `${t.id} ${t.title}: ${t.verdict} (${t.value})`).join('\n') || 'none'}\n\nGOALS:\n${JSON.stringify(data.goals)}\n\nSPEND BY CATEGORY (₹): ${JSON.stringify(data.spendByCategory)}\n\nCOMPETITOR CHANGES:\n${JSON.stringify(data.competitors).slice(0, 3000)}\n\nWEEKLY SUMMARIES:\n${data.weekly.map((w) => `${w.date}: ${w.summary}`).join('\n\n')}`;
        ai = (await runClaude<MonthlyAi>(prompt, token, { enabled: [] }, now + 10 * 60_000, MONTHLY_MODE)).report;
        const ids = data.facts.map((f) => f.id);
        const all = [ai.headline, ai.summary, ...ai.wins, ...ai.misses, ...ai.nextMonth].join(' ');
        const bad = unsupportedNumbers(all, ids, data.facts).filter((n) => !data.measured.some((t) => t.value.includes(n)) && !month.includes(n));
        if (bad.length) aiProblems = [`numbers not in the month's facts: ${bad.join(', ')}`];
      } catch (e) {
        aiError = (e as Error).message.slice(0, 300);
      }
    } else aiError = 'Claude token not set up';
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `MONTHLY#${month}`, month, at: now, by: opts.by, data, ...(ai ? { ai } : {}), ...(aiError ? { aiError } : {}), ...(aiProblems.length ? { aiProblems } : {}) } }));
    const f = (id: string) => data.facts.find((x) => x.id === id)?.value ?? '—';
    await sendToOwners(
      `Lens growth: ${month} in review`,
      [ai ? `${ai.headline}\n\n${ai.summary}` : `The month in numbers (the AI write-up didn't run${aiError ? `: ${aiError}` : ''}).`, '', `Installs ${f('month.installs')} · backed up ${f('month.backed_up')} · paying ${f('month.paying')} · spend ₹${f('month.spend')} · cost per install ₹${f('month.cac')}`, `Tasks finished ${f('month.tasks_done')} · results measured ${f('month.results')} (${f('month.worked')} worked)`, ...(ai?.nextMonth.length ? ['', 'Next month:', ...ai.nextMonth.map((x) => `- ${x}`)] : []), '', `Full review: ${CONSOLE}/growth/insights?monthly=${month}`].join('\n'),
    ).catch((e) => console.error('monthly email', e));
    await releaseLock(lockAt);
    return { month, ai: !!ai };
  } catch (e) {
    await releaseLock(lockAt, `Monthly ${month}: ${(e as Error).message}`);
    throw e;
  }
}

/** GET /growth/monthly[?month=YYYY-MM]: the list of months and one review. */
export async function monthlyPage(req: Req): Promise<Res> {
  const list = ((await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'MONTHLY#' }, ScanIndexForward: false, ProjectionExpression: '#m, #a', ExpressionAttributeNames: { '#m': 'month', '#a': 'at' } }))).Items ?? []).map((i) => String(i.month));
  const month = /^\d{4}-\d{2}$/.test(req.query.month ?? '') ? req.query.month! : list[0];
  const review = month ? (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `MONTHLY#${month}` } }))).Item : undefined;
  return json(200, { months: list, review: review ?? null });
}

/** POST /growth/monthly/run {month?}: write a month-in-review now (GrowthAnalyst). */
export async function monthlyRun(req: Req, email: string): Promise<Res> {
  if (!process.env.GROWTH_FUNCTION) throw new HttpError(503, 'The growth analyst is not deployed');
  await rateLimit('console-monthly-run', 4, 'A review was started recently. Try again in an hour.');
  const month = typeof req.body?.month === 'string' && /^\d{4}-\d{2}$/.test(req.body.month) ? req.body.month : undefined;
  const lockAt = await takeLock(`monthly:${email}`, true);
  if (lockAt === undefined) throw new HttpError(409, 'The analyst is busy. Try again in about 10 minutes.');
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.GROWTH_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ monthly: true, month, by: email, lockAt })) }));
  return json(202, { started: true });
}
