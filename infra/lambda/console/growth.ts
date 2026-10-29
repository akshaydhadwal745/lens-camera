// The weekly growth report (docs/growth/growth-engine.md §2) and its Console routes.
//   GROWTH / REPORT#<YYYY-MM-DD>  { facts, rules, ai?, aiProblems?, aiError?, model?, at, by }
//   GROWTH / REC#<id>             { id, title, …recommendation, status, note?, report, createdAt, updatedAt }
//   GROWTH / ACT#<at>#<n>         every growth-tool call: tool, level, args, ok, refused?, error?, result size, report
//   GROWTH / PROP#<id>            level-3 proposals (propose_change): status proposed → approved | rejected
//   GROWTH / WATCH#<path>         pages to follow after a recommendation: reason, since, baseline
//   GROWTH / TOOLS                { enabled: [...level-2 tool names] }, set by the owner
// The report runs in its own Lambda (GrowthAnalyst, a container with the Claude Code CLI, weekly and
// on demand). The Console reads and edits rows here. The analyst only reads facts; it changes nothing.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, HttpError, json, rateLimit, Req, Res } from '../api/lib';
import { googleToken, indexCoverage } from '../api/search-console';
import { compute } from './analytics';
import { fact, indexFacts, productFacts, searchFacts, type Fact, type SearchDay, type SearchRow } from './growth-facts';
import { ANALYST_SYSTEM, analystPrompt, numbersIn, REPORT_SCHEMA, ruleFindings, validateReport, type AiReport, type OpenRec } from './growth-report';
import { log } from './log';
import { teamMembers } from './roles';

const DAY = 86_400_000;
const CONSOLE = process.env.CONSOLE_ORIGIN ?? 'https://console.lens.instagrowapp.com';
const STATUSES = ['proposed', 'approved', 'shipped', 'measured', 'kept', 'dropped'] as const;
const OPEN = new Set(['proposed', 'approved', 'shipped', 'measured']);
/** Level-2 tools the owner may switch on (growth-mcp.ts enforces it). */
export const LEVEL2_TOOLS = ['submit_sitemap'] as const;
const TOOL_NAMES = ['search_analytics', 'compare_periods', 'inspect_url', 'list_sitemaps', 'audit_page', 'find_in_code', 'read_code', 'watch_page', 'submit_sitemap', 'propose_change'];
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

async function searchDays(now: number): Promise<SearchDay[]> {
  const days = Array.from({ length: 56 }, (_, i) => new Date(now - (56 - i) * DAY).toISOString().slice(0, 10));
  return Promise.all(
    days.map(async (day) => {
      const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `GSC#${day}` } }));
      return { day, rows: (r.Items ?? []) as SearchRow[] };
    }),
  );
}

export async function collectFacts(now = Date.now()): Promise<{ facts: Fact[]; notes: string[] }> {
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
  return { facts, notes };
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
        .map((l) => JSON.parse(l) as ToolEntry)
    : [];

// ---------- the analyst (Claude Code CLI, headless; its only tools are the growth MCP server) ----------

type ToolSetup = { googleToken?: string; writeToken?: string; enabled: string[]; commit?: string };

function runClaude(prompt: string, token: string, tools: ToolSetup, deadline: number): Promise<{ report: AiReport; model?: string }> {
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
            GROWTH_ENABLED_TOOLS: tools.enabled.join(','),
            GROWTH_CODE_DIR: CODE_DIR,
            GROWTH_CODE_COMMIT: tools.commit ?? '',
            GROWTH_TOOL_LOG: TOOL_LOG,
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
    TOOL_NAMES.map((t) => `mcp__growth__${t}`).join(','),
    '--no-session-persistence',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(REPORT_SCHEMA),
    '--system-prompt',
    ANALYST_SYSTEM,
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
        const r = JSON.parse(out.slice(out.indexOf('{'))) as { is_error?: boolean; result?: string; structured_output?: AiReport; modelUsage?: Record<string, unknown> };
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
  try {
    let { report, model } = await runClaude(prompt, token, tools, deadline);
    let problems = check(report);
    if (problems.length && deadline - Date.now() > 5 * 60_000) {
      ({ report, model } = await runClaude(`${prompt}\n\nYour previous answer broke the rules:\n${problems.map((p) => `- ${p}`).join('\n')}\nFix these: only numbers from cited facts or tool results, only existing fact ids, and code locations copied exactly from tool results.`, token, tools, deadline));
      problems = check(report);
    }
    return { ai: report, model, ...(problems.length ? { aiProblems: problems } : {}) };
  } catch (e) {
    return { aiError: (e as Error).message.slice(0, 400) };
  }
}

/** Tool calls → activity rows; proposals and watched pages → their own rows. */
async function saveToolActivity(date: string, now: number) {
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
      const id = `P-${date}-${i + 1}`;
      await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `PROP#${id}`, id, ...t.args, status: 'proposed', report: date, createdAt: now }, ConditionExpression: 'attribute_not_exists(pk)' })).catch(() => {});
    }
    if (t.tool === 'watch_page') {
      const w = t.result as { watching: string; reason: string };
      await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `WATCH#${w.watching}`, path: w.watching, reason: w.reason, since: date, report: date }, ConditionExpression: 'attribute_not_exists(pk)' })).catch(() => {});
    }
  }
  return entries.length;
}

// ---------- recommendations ledger ----------

async function recs(): Promise<Record<string, any>[]> {
  const r = await ddb.send(
    new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'REC#' }, ScanIndexForward: false }),
  );
  return r.Items ?? [];
}

// ---------- the weekly run (GrowthAnalyst Lambda) ----------

export async function runGrowthReport(opts: { ai: boolean; by: string }) {
  const now = Date.now();
  const date = new Date(now).toISOString().slice(0, 10);
  const { facts, notes } = await collectFacts(now);
  const rules = ruleFindings(facts);
  const open: OpenRec[] = (await recs()).filter((r) => OPEN.has(r.status)).map((r) => ({ id: r.id, title: r.title, status: r.status, createdAt: r.createdAt, metric: r.metric, note: r.note }));
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
      enabled,
      commit,
    };
    ai = await analyst(facts, analystPrompt(facts, rules, open), tools, now);
    toolCalls = await saveToolActivity(date, now);
  }
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `REPORT#${date}`, date, at: now, by: opts.by, facts, rules, notes, commit, toolCalls, ...ai } }));
  // New recommendations join the ledger as "proposed"; the owner moves them along in the Console.
  for (const [i, rec] of (ai.ai?.recommendations ?? []).entries()) {
    const id = `R-${date}-${i + 1}`;
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `REC#${id}`, id, ...rec, status: 'proposed', report: date, createdAt: date, updatedAt: now }, ConditionExpression: 'attribute_not_exists(pk)' })).catch(() => {});
  }
  await emailOwners(date, rules.length, ai).catch((e) => console.error('growth email', e));
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'RUNNING' }, UpdateExpression: 'SET #a = :z', ExpressionAttributeNames: { '#a': 'at' }, ExpressionAttributeValues: { ':z': 0 } }));
  console.log('growth report', JSON.stringify({ date, facts: facts.length, rules: rules.length, ai: !!ai.ai, aiProblems: ai.aiProblems?.length ?? 0, aiError: ai.aiError }));
  return { date, facts: facts.length, rules: rules.length, ai: !!ai.ai, aiError: ai.aiError };
}

async function emailOwners(date: string, rules: number, ai: { ai?: AiReport; aiError?: string }) {
  const sender = process.env.CODE_SENDER ?? '';
  const to = (await teamMembers()).filter((m) => m.role === 'owner').map((m) => m.email);
  if (!sender.startsWith('no-reply@') || !to.length) return;
  const body = [
    ai.ai ? ai.ai.summary : `This week's report has ${rules} rule-based findings.${ai.aiError ? ' (The AI analysis did not run.)' : ''}`,
    '',
    ...(ai.ai?.recommendations ?? []).map((r, i) => `${i + 1}. ${r.title}`),
    '',
    `Full report: ${CONSOLE}/growth`,
  ].join('\n');
  await new SESv2Client({}).send(
    new SendEmailCommand({
      FromEmailAddress: `Lens Console <${sender}>`,
      Destination: { ToAddresses: to },
      Content: { Simple: { Subject: { Data: `Lens growth report · ${date}` }, Body: { Text: { Data: body } } } },
    }),
  );
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
  const [proposals, watching, activity] = await Promise.all([rows('PROP#'), rows('WATCH#'), rows('ACT#', 80)]);
  return json(200, {
    dates,
    report: report ?? null,
    recommendations: await recs(),
    proposals,
    watching,
    activity,
    tools: { available: LEVEL2_TOOLS, enabled: await enabledTools() },
    running: running && Date.now() - running.at < 20 * 60_000 ? running : null,
  });
}

/** POST /growth/run {ai?: boolean}: a fresh report now (async; takes a few minutes). */
export async function growthRun(req: Req, email: string): Promise<Res> {
  if (!process.env.GROWTH_FUNCTION) throw new HttpError(503, 'The growth analyst is not deployed');
  await rateLimit('console-growth-run', 4, 'A report was started recently. Try again in an hour.');
  const ai = req.body?.ai !== false;
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'RUNNING', at: Date.now(), by: email, ai } }));
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.GROWTH_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ growth: true, ai, by: email })) }));
  await log({ entity: 'growth:report', action: 'growth.report-run', actor: `console:${email}`, data: { ai } });
  return json(202, { started: true });
}

/** PUT /growth/recs/<id> {status, note?}: move a recommendation along the ledger. */
export async function growthRec(id: string, req: Req, email: string): Promise<Res> {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
  await ddb
    .send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: 'GROWTH', sk: `REC#${id}` },
        UpdateExpression: `SET #s = :s, updatedAt = :t, updatedBy = :b${note !== undefined ? ', note = :n' : ''}`,
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': status, ':t': Date.now(), ':b': email, ...(note !== undefined ? { ':n': note } : {}) },
      }),
    )
    .catch((e) => {
      if (e?.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'No such recommendation');
      throw e;
    });
  await log({ entity: `growth:${id}`, action: 'growth.recommendation-status', actor: `console:${email}`, data: { status, ...(note !== undefined ? { note } : {}) } });
  return json(200, { ok: true });
}

/** PUT /growth/proposals/<id> {decision: approved|rejected, note?}: the owner's answer to a level-3 proposal. */
export async function growthProposal(id: string, req: Req, email: string): Promise<Res> {
  const decision = req.body?.decision;
  if (decision !== 'approved' && decision !== 'rejected') throw new HttpError(400, 'decision must be approved or rejected');
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
  await ddb
    .send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: 'GROWTH', sk: `PROP#${id}` },
        UpdateExpression: `SET #s = :s, decidedAt = :t, decidedBy = :b${note !== undefined ? ', note = :n' : ''}`,
        ConditionExpression: 'attribute_exists(pk) AND #s = :proposed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': decision, ':t': Date.now(), ':b': email, ':proposed': 'proposed', ...(note !== undefined ? { ':n': note } : {}) },
      }),
    )
    .catch((e) => {
      if (e?.name === 'ConditionalCheckFailedException') throw new HttpError(409, 'No such open proposal');
      throw e;
    });
  await log({ entity: `growth:${id}`, action: `growth.proposal-${decision}`, actor: `console:${email}`, data: note ? { note } : undefined });
  return json(200, { ok: true });
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
