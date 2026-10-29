// The weekly growth report (docs/growth/growth-engine.md §2) and its Console routes.
//   GROWTH / REPORT#<YYYY-MM-DD>  { facts, rules, ai?, aiProblems?, aiError?, model?, at, by }
//   GROWTH / REC#<id>             { id, title, …recommendation, status, note?, report, createdAt, updatedAt }
// The report runs in its own Lambda (GrowthAnalyst, a container with the Claude Code CLI, weekly and
// on demand). The Console reads and edits rows here. The analyst only reads facts; it changes nothing.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, HttpError, json, rateLimit, Req, Res } from '../api/lib';
import { indexCoverage } from '../api/search-console';
import { compute } from './analytics';
import { indexFacts, productFacts, searchFacts, type Fact, type SearchDay, type SearchRow } from './growth-facts';
import { ANALYST_SYSTEM, analystPrompt, REPORT_SCHEMA, ruleFindings, validateReport, type AiReport, type OpenRec } from './growth-report';
import { log } from './log';
import { teamMembers } from './roles';

const DAY = 86_400_000;
const CONSOLE = process.env.CONSOLE_ORIGIN ?? 'https://console.lens.instagrowapp.com';
const STATUSES = ['proposed', 'approved', 'shipped', 'measured', 'kept', 'dropped'] as const;
const OPEN = new Set(['proposed', 'approved', 'shipped', 'measured']);

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
  try {
    const coverage = await indexCoverage();
    if (coverage) facts.push(...indexFacts(coverage));
    else notes.push('Index coverage skipped: the Search Console key is not set up.');
  } catch (e) {
    notes.push(`Index coverage failed: ${(e as Error).message.slice(0, 120)}`);
  }
  facts.push(...productFacts(await compute(30)));
  return { facts, notes };
}

// ---------- the analyst (Claude Code CLI, headless, no tools) ----------

function runClaude(prompt: string, token: string): Promise<{ report: AiReport; model?: string }> {
  const home = '/tmp/claude-home';
  mkdirSync(home, { recursive: true });
  const args = ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--json-schema', JSON.stringify(REPORT_SCHEMA), '--system-prompt', ANALYST_SYSTEM, '--model', 'opus'];
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_CODE_OAUTH_TOKEN: token, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out) as { is_error?: boolean; result?: string; structured_output?: AiReport; modelUsage?: Record<string, unknown> };
        if (r.is_error || !r.structured_output) throw new Error(String(r.result ?? 'no structured output').slice(0, 200));
        resolve({ report: r.structured_output, model: Object.keys(r.modelUsage ?? {}).find((m) => m.includes('opus') || m.includes('sonnet')) });
      } catch (e) {
        reject(new Error(`claude exited ${code}: ${(e as Error).message} ${err.slice(0, 200)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/** The AI report, checked; one retry with the problems listed. Returns what it got and anything still wrong. */
async function analyst(facts: Fact[], prompt: string): Promise<{ ai?: AiReport; aiProblems?: string[]; aiError?: string; model?: string }> {
  const token = await getParam('/lens/growth/claude-token');
  if (!token) return { aiError: 'Claude token not set up (SSM /lens/growth/claude-token).' };
  const started = Date.now();
  try {
    let { report, model } = await runClaude(prompt, token);
    let problems = validateReport(report, facts);
    // One retry with the problems listed, if the 15-minute Lambda has time left for it.
    if (problems.length && Date.now() - started < 5 * 60_000) {
      ({ report, model } = await runClaude(`${prompt}\n\nYour previous answer broke the rules:\n${problems.map((p) => `- ${p}`).join('\n')}\nFix these: only use numbers from the facts you cite, and only existing fact ids.`, token));
      problems = validateReport(report, facts);
    }
    return { ai: report, model, ...(problems.length ? { aiProblems: problems } : {}) };
  } catch (e) {
    return { aiError: (e as Error).message.slice(0, 400) };
  }
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
  const ai = opts.ai ? await analyst(facts, analystPrompt(facts, rules, open)) : {};
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `REPORT#${date}`, date, at: now, by: opts.by, facts, rules, notes, ...ai } }));
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
  return json(200, { dates, report: report ?? null, recommendations: await recs(), running: running && Date.now() - running.at < 20 * 60_000 ? running : null });
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
