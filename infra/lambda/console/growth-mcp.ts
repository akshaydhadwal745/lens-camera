// Growth tools for the analyst (docs/growth/seo-agent.md §2.2): an MCP server over stdio, started by
// the Claude Code CLI inside the GrowthAnalyst Lambda. No AWS credentials: it gets a short-lived
// Google token, the list of enabled level-2 tools, a read-only copy of the website code and a log
// file (env). Permissions are enforced here, not in the prompt:
//   level 1  read and analyse         always on
//   level 2  low-risk, reversible     only if the owner enabled the tool (Console → Growth → Tools)
//   level 3  needs approval           never executes: records a proposal the owner approves or rejects
// Every call (allowed or refused) is appended to the log; the Lambda stores it as GROWTH / ACT#.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';
import { createInterface } from 'node:readline';

const SITE = 'https://lens.instagrowapp.com';
const PROPERTY = `${SITE}/`;
const TOKEN = process.env.GROWTH_GOOGLE_TOKEN ?? '';
const SUBMIT_TOKEN = process.env.GROWTH_GOOGLE_WRITE_TOKEN ?? '';
const ENABLED = new Set((process.env.GROWTH_ENABLED_TOOLS ?? '').split(',').filter(Boolean));
const CODE = process.env.GROWTH_CODE_DIR ?? '/tmp/growth-code';
const LOG = process.env.GROWTH_TOOL_LOG ?? '/tmp/growth-tools.jsonl';
const LIMITS: Record<string, number> = { inspect_url: 40, audit_page: 30, search_analytics: 40, compare_periods: 30, find_in_code: 60, read_code: 60, propose_change: 5, watch_page: 10, submit_sitemap: 1 };
// Per report, not per process: the retry run starts a new server, so earlier calls count too.
const used: Record<string, number> = {};
if (existsSync(LOG))
  for (const l of readFileSync(LOG, 'utf8').split('\n')) {
    try {
      const e = JSON.parse(l) as { tool?: unknown; refused?: boolean };
      if (typeof e.tool === 'string' && !e.refused) used[e.tool] = (used[e.tool] ?? 0) + 1; // refused calls never ran
    } catch {
      // a line cut short by a time-limit kill
    }
  }

type Args = Record<string, unknown>;
type Tool = { level: 1 | 2 | 3; description: string; inputSchema: Record<string, unknown>; run: (a: Args) => Promise<unknown> };

class Refused extends Error {}
const str = (a: Args, k: string, max = 300) => {
  const v = a[k];
  if (typeof v !== 'string' || !v.trim()) throw new Refused(`"${k}" is required`);
  return v.slice(0, max);
};
const ourPath = (p: string) => {
  const path = p.startsWith(SITE) ? p.slice(SITE.length) : p;
  if (!/^\/[\w\-/.]*$/.test(path) || path.includes('..')) throw new Refused('path must be a page on lens.instagrowapp.com, like /features/');
  return path.endsWith('/') || path.includes('.') ? path : `${path}/`;
};
const date = (v: unknown, k: string) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Refused(`${k} must be YYYY-MM-DD`);
  return v;
};
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

async function google(url: string, body?: unknown, token = TOKEN) {
  if (!token) throw new Refused('Search Console is not connected');
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : body === null ? 'PUT' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google API ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

type Row = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
async function analytics(start: string, end: string, dimensions: string[], filters: { dimension: string; expression: string }[] = [], rowLimit = 100): Promise<Row[]> {
  const r = await google(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`, {
    startDate: start,
    endDate: end,
    dimensions,
    rowLimit,
    dataState: 'all',
    ...(filters.length ? { dimensionFilterGroups: [{ filters: filters.map((f) => ({ ...f, operator: 'equals' })) }] } : {}),
  });
  return ((r.rows ?? []) as Row[]).map((x) => ({ ...x, ctr: Math.round(x.ctr * 10000) / 10000, position: Math.round(x.position * 10) / 10 }));
}

// ---------- code (a read-only copy of the website code at one commit) ----------
const codeFiles = (): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(CODE, p));
    }
  };
  if (existsSync(CODE)) walk(CODE);
  return out;
};
const safeFile = (f: string) => {
  const p = normalize(f).replace(/^\/+/, '');
  if (p.startsWith('..') || !existsSync(join(CODE, p))) throw new Refused(`no such file in the code copy: ${f}`);
  return p;
};
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function find(text: string, max = 20) {
  const variants = [...new Set([text, text.replace(/'/g, '’'), text.replace(/’/g, "'"), text.replace(/'/g, "\\'")])];
  const hits: { file: string; line: number; excerpt: string }[] = [];
  for (const f of codeFiles()) {
    const lines = readFileSync(join(CODE, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (hits.length < max && variants.some((v) => l.includes(v))) hits.push({ file: f, line: i + 1, excerpt: l.trim().slice(0, 240) });
    });
  }
  return hits;
}

// ---------- tools ----------
const TOOLS: Record<string, Tool> = {
  search_analytics: {
    level: 1,
    description: 'Google Search Console search analytics for lens.instagrowapp.com. Dimensions: query, page, country, device, date. Optional exact filters on page (full URL or path) or query. Data is about 3 days behind.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        dimensions: { type: 'array', items: { enum: ['query', 'page', 'country', 'device', 'date'] } },
        page: { type: 'string' },
        query: { type: 'string' },
        rowLimit: { type: 'number', description: 'max 500' },
      },
      required: ['startDate', 'endDate'],
    },
    run: async (a) => {
      const dims = Array.isArray(a.dimensions) ? (a.dimensions as string[]).filter((d) => ['query', 'page', 'country', 'device', 'date'].includes(d)) : [];
      const filters = [
        ...(typeof a.page === 'string' ? [{ dimension: 'page', expression: `${SITE}${ourPath(a.page)}` }] : []),
        ...(typeof a.query === 'string' ? [{ dimension: 'query', expression: a.query.slice(0, 200) }] : []),
      ];
      return { rows: await analytics(date(a.startDate, 'startDate'), date(a.endDate, 'endDate'), dims, filters, Math.min(500, Number(a.rowLimit) || 100)) };
    },
  },
  compare_periods: {
    level: 1,
    description: 'Compare the last N days with the N days before (N = 7 or 28) by query, page, country or device: clicks, impressions, CTR, position, with changes. Ends 3 days ago (Search Console delay).',
    inputSchema: { type: 'object', properties: { dimension: { enum: ['query', 'page', 'country', 'device'] }, days: { enum: [7, 28] }, page: { type: 'string' } }, required: ['dimension'] },
    run: async (a) => {
      const dim = ['query', 'page', 'country', 'device'].includes(String(a.dimension)) ? String(a.dimension) : 'query';
      const n = a.days === 7 ? 7 : 28;
      const filters = typeof a.page === 'string' ? [{ dimension: 'page', expression: `${SITE}${ourPath(a.page)}` }] : [];
      const [now, before] = await Promise.all([analytics(iso(n + 2), iso(3), [dim], filters, 500), analytics(iso(2 * n + 2), iso(n + 3), [dim], filters, 500)]);
      const prev = new Map(before.map((r) => [r.keys?.[0], r]));
      const keys = [...new Set([...now.map((r) => r.keys?.[0]), ...before.map((r) => r.keys?.[0])])];
      return {
        window: `${iso(n + 2)}..${iso(3)} vs ${iso(2 * n + 2)}..${iso(n + 3)}`,
        rows: keys
          .map((k) => {
            const c = now.find((r) => r.keys?.[0] === k);
            const p = prev.get(k);
            return { key: k, impressions: c?.impressions ?? 0, impressionsBefore: p?.impressions ?? 0, clicks: c?.clicks ?? 0, clicksBefore: p?.clicks ?? 0, position: c?.position ?? null, positionBefore: p?.position ?? null };
          })
          .sort((x, y) => Math.abs(y.impressions - y.impressionsBefore) - Math.abs(x.impressions - x.impressionsBefore))
          .slice(0, 50),
      };
    },
  },
  inspect_url: {
    level: 1,
    description: "Google's index status for one page: verdict, coverage state, last crawl, Google's and our canonical, robots and indexing state, referring URLs, sitemaps.",
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'e.g. /features/night-mode/' } }, required: ['path'] },
    run: async (a) => {
      const r = await google('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { inspectionUrl: `${SITE}${ourPath(str(a, 'path'))}`, siteUrl: PROPERTY });
      const s = r.inspectionResult?.indexStatusResult ?? {};
      return { verdict: s.verdict, coverageState: s.coverageState, lastCrawlTime: s.lastCrawlTime ?? null, googleCanonical: s.googleCanonical ?? null, userCanonical: s.userCanonical ?? null, robotsTxtState: s.robotsTxtState, indexingState: s.indexingState, pageFetchState: s.pageFetchState, referringUrls: s.referringUrls ?? [], sitemaps: s.sitemap ?? [] };
    },
  },
  list_sitemaps: {
    level: 1,
    description: 'Sitemaps Google knows for the site: last downloaded, errors, warnings, URLs submitted and indexed.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await google(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/sitemaps`)).sitemap ?? [],
  },
  audit_page: {
    level: 1,
    description: 'Fetch a live page and report its SEO head (title, description and their lengths, canonical, robots, hreflang, structured data types), h1s, word count and internal links, plus the source file and line that produce the title and description.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async (a) => {
      const path = ourPath(str(a, 'path'));
      const res = await fetch(`${SITE}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      const html = await res.text();
      const head = html.slice(0, Math.max(0, html.indexOf('</head>')));
      const main = (html.match(/<main[\s\S]*<\/main>/i) ?? [html])[0];
      const title = decode(head.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '');
      const description = decode(head.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ?? '');
      const bareTitle = title.replace(/ \| Lens( by InstaGrow)?$/, '');
      return {
        status: res.status,
        location: res.headers.get('location'),
        title,
        titleLength: title.length,
        description,
        descriptionLength: description.length,
        canonical: head.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i)?.[1] ?? null,
        robots: head.match(/<meta[^>]+name="robots"[^>]+content="([^"]*)"/i)?.[1] ?? null,
        hreflang: [...head.matchAll(/hreflang="([^"]+)"[^>]*href="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`),
        structuredData: [...html.matchAll(/"@type":"([A-Za-z]+)"/g)].map((m) => m[1]).filter((t, i, all) => all.indexOf(t) === i),
        h1: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, '').trim())),
        words: main.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
        internalLinksInContent: [...new Set([...main.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]))].slice(0, 60),
        titleSource: find(bareTitle, 3),
        descriptionSource: find(description.slice(0, 60), 3),
      };
    },
  },
  find_in_code: {
    level: 1,
    description: 'Search the website code (site/ and docs/growth at the current main commit) for exact text. Returns file, line and the line itself.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async (a) => ({ commit: process.env.GROWTH_CODE_COMMIT, hits: find(str(a, 'text', 200), 30) }),
  },
  read_code: {
    level: 1,
    description: 'Read lines of a file from the website code copy (max 200 lines).',
    inputSchema: { type: 'object', properties: { file: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' } }, required: ['file'] },
    run: async (a) => {
      const f = safeFile(str(a, 'file'));
      const lines = readFileSync(join(CODE, f), 'utf8').split('\n');
      const start = Math.max(1, Number(a.startLine) || 1);
      const end = Math.min(lines.length, Number(a.endLine) || start + 79, start + 199);
      return { commit: process.env.GROWTH_CODE_COMMIT, file: f, lines: lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n') };
    },
  },
  watch_page: {
    level: 1,
    description: 'Add a page to the watchlist so later reports track its index state, impressions, clicks and position against today. Use after recommending a change for that page.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, reason: { type: 'string' } }, required: ['path', 'reason'] },
    run: async (a) => ({ watching: ourPath(str(a, 'path')), reason: str(a, 'reason', 300) }),
  },
  submit_sitemap: {
    level: 2,
    description: 'Resubmit the sitemap to Google (level 2: only works if the owner enabled it). Use only after pages were added or removed.',
    inputSchema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    run: async () => {
      await google(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/sitemaps/${encodeURIComponent(`${SITE}/sitemap-index.xml`)}`, null, SUBMIT_TOKEN);
      return { submitted: `${SITE}/sitemap-index.xml` };
    },
  },
  propose_change: {
    level: 3,
    description: 'Propose a code or content change for owner approval. Nothing is changed: the proposal waits in the Console, and an approved one becomes a pull request (never merged automatically).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        evidence: { type: 'string', description: 'the data and code evidence, with numbers from tool results' },
        files: { type: 'array', items: { type: 'string' }, description: 'file:line locations to change' },
        change: { type: 'string', description: 'the exact change' },
        validation: { type: 'string' },
        measurement: { type: 'string' },
      },
      required: ['title', 'evidence', 'files', 'change', 'validation', 'measurement'],
    },
    run: async (a) => {
      const files = Array.isArray(a.files) ? a.files.filter((f): f is string => typeof f === 'string').slice(0, 20).map((f) => f.slice(0, 200)) : [];
      if (!files.length) throw new Refused('"files" must list file:line locations');
      return {
        proposal: 'recorded for owner approval; nothing was changed',
        title: str(a, 'title', 200),
        evidence: str(a, 'evidence', 3000),
        files,
        change: str(a, 'change', 3000),
        validation: str(a, 'validation', 1000),
        measurement: str(a, 'measurement', 1000),
      };
    },
  },
};

// ---------- MCP over stdio ----------
const send = (m: unknown) => process.stdout.write(`${JSON.stringify(m)}\n`);
const log = (entry: Record<string, unknown>) => appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);

async function call(name: string, args: Args) {
  const tool = TOOLS[name];
  if (!tool) throw new Refused(`unknown tool ${name}`);
  if (tool.level === 2 && !ENABLED.has(name)) throw new Refused(`${name} is a level-2 tool and is not enabled by the owner`);
  const known = Object.keys((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
  const extra = Object.keys(args).filter((k) => !known.includes(k));
  if (extra.length) throw new Refused(`unknown arguments: ${extra.join(', ').slice(0, 100)}`);
  used[name] = (used[name] ?? 0) + 1;
  if (used[name] > (LIMITS[name] ?? 20)) throw new Refused(`${name}: limit of ${LIMITS[name]} calls per report reached`);
  return tool.run(args);
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let m: { id?: number | string; method?: string; params?: any };
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'growth', version: '1.0' } } });
  if (m.method === 'tools/list')
    return send({
      jsonrpc: '2.0',
      id: m.id,
      result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: `[level ${t.level}] ${t.description}`, inputSchema: { ...t.inputSchema, additionalProperties: false } })) },
    });
  if (m.method === 'tools/call') {
    const name = String(m.params?.name ?? '');
    const raw = m.params?.arguments;
    const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Args;
    const started = Date.now();
    try {
      const result = await call(name, args);
      log({ tool: name, level: TOOLS[name]?.level, args, ok: true, result, ms: Date.now() - started });
      return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(result).slice(0, 60_000) }] } });
    } catch (e) {
      const refused = e instanceof Refused;
      log({ tool: name, level: TOOLS[name]?.level, args, ok: false, refused, error: (e as Error).message.slice(0, 300), ms: Date.now() - started });
      return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `${refused ? 'REFUSED' : 'ERROR'}: ${(e as Error).message.slice(0, 300)}` }], isError: true } });
    }
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
