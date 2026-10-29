// Run: cd infra && npx tsx --test lambda/console/growth-mcp.test.ts
// The growth tool server enforces permissions itself: level-2 tools only when enabled, level-3 only
// records proposals, code reads stay inside the code copy, inputs are validated, every call is logged.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { fact } from './growth-facts';
import { numbersIn, unverifiedLocations, validateReport } from './growth-report';

const dir = mkdtempSync(join(tmpdir(), 'growth-mcp-'));
const code = join(dir, 'code');
mkdirSync(join(code, 'site/src/layouts'), { recursive: true });
writeFileSync(join(code, 'site/src/layouts/Layout.astro'), "---\nconst a = 1;\n---\n<link rel=\"alternate\" hreflang=\"en\" />\n<title>Night mode camera for clear low-light photos</title>\n");
writeFileSync(join(dir, 'secret.txt'), 'do not read');
const logFile = join(dir, 'tools.jsonl');

function server(enabled = '') {
  const child = spawn(process.execPath, ['--import', 'tsx', join(__dirname, 'growth-mcp.ts')], {
    env: { ...process.env, GROWTH_ENABLED_TOOLS: enabled, GROWTH_CODE_DIR: code, GROWTH_CODE_COMMIT: 'abc123', GROWTH_TOOL_LOG: logFile, GROWTH_GOOGLE_TOKEN: '' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let buf = '';
  const waiting = new Map<number, (v: any) => void>();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(m.id)?.(m);
    }
  });
  let id = 0;
  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((resolve) => {
      waiting.set(++id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const callTool = async (name: string, args: Record<string, unknown> = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  return { rpc, callTool, stop: () => child.kill() };
}

test('lists tools with their permission level', async () => {
  const s = server();
  await s.rpc('initialize', { protocolVersion: '2025-06-18' });
  const tools = (await s.rpc('tools/list')).result.tools as { name: string; description: string }[];
  s.stop();
  assert.ok(tools.find((t) => t.name === 'inspect_url')!.description.startsWith('[level 1]'));
  assert.ok(tools.find((t) => t.name === 'submit_sitemap')!.description.startsWith('[level 2]'));
  assert.ok(tools.find((t) => t.name === 'propose_change')!.description.startsWith('[level 3]'));
});

test('level 2 is refused unless enabled; level 3 only records a proposal', async () => {
  const s = server();
  const refused = await s.callTool('submit_sitemap', { reason: 'test' });
  const proposal = await s.callTool('propose_change', { title: 'Shorter title', evidence: 'x', files: ['a:1'], change: 'y', validation: 'z', measurement: 'w' });
  s.stop();
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /REFUSED: submit_sitemap is a level-2 tool and is not enabled/);
  assert.match(proposal.content[0].text, /nothing was changed/);
});

test('enabled level-2 tool gets past the permission check (then needs Google, which is absent here)', async () => {
  const s = server('submit_sitemap');
  const r = await s.callTool('submit_sitemap', { reason: 'test' });
  s.stop();
  assert.match(r.content[0].text, /Search Console is not connected/);
});

test('code tools: find and read inside the copy only', async () => {
  const s = server();
  const found = JSON.parse((await s.callTool('find_in_code', { text: 'Night mode camera for clear' })).content[0].text);
  const read = JSON.parse((await s.callTool('read_code', { file: 'site/src/layouts/Layout.astro', startLine: 4, endLine: 4 })).content[0].text);
  const escape = await s.callTool('read_code', { file: '../secret.txt' });
  const badPath = await s.callTool('inspect_url', { path: 'https://evil.example/x' });
  s.stop();
  assert.deepEqual(found.hits, [{ file: 'site/src/layouts/Layout.astro', line: 5, excerpt: '<title>Night mode camera for clear low-light photos</title>' }]);
  assert.equal(read.lines, '4: <link rel="alternate" hreflang="en" />');
  assert.equal(escape.isError, true);
  assert.equal(badPath.isError, true);
  assert.match(badPath.content[0].text, /REFUSED: path must be a page on lens.instagrowapp.com/);
});

test('every call is logged, refused ones too', () => {
  const lines = readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.tool === 'submit_sitemap' && l.refused === true));
  assert.ok(lines.some((l) => l.tool === 'propose_change' && l.ok === true && l.level === 3));
  assert.ok(lines.some((l) => l.tool === 'read_code' && l.ok === false));
});

test('code locations in a report are checked against the code', () => {
  const read = (f: string) => (f === 'site/src/layouts/Layout.astro' ? readFileSync(join(code, f), 'utf8') : undefined);
  assert.deepEqual(unverifiedLocations([{ file: 'site/src/layouts/Layout.astro', line: 4, excerpt: 'hreflang="en"' }], read), []);
  assert.deepEqual(unverifiedLocations([{ file: 'site/src/layouts/Layout.astro', line: 4, excerpt: 'hreflang="en-IN"' }], read), ["site/src/layouts/Layout.astro:4: the quoted text isn't there"]);
  assert.deepEqual(unverifiedLocations([{ file: 'site/src/nope.ts', line: 1, excerpt: 'x' }], read), ['site/src/nope.ts: no such file']);
});

test('numbers from tool results are allowed in investigations', () => {
  const n = numbersIn([{ impressions: 120, ctr: 0.0125, position: 12.3 }, 'title is 68 characters']);
  for (const x of [120, 0.0125, 1.25, 12.3, 68]) assert.ok(n.has(x), String(x));
});

test('a report may quote tool results anywhere, but not invented numbers', () => {
  const facts = [fact({ id: 'search.impressions', area: 'search', label: 'Impressions', value: 0, unit: 'count', window: '28 days' })];
  const report = { summary: 'Google accepted 64 URLs; the guide has 399 words.', findings: [], recommendations: [], reviewOfPrevious: [] };
  assert.deepEqual(validateReport(report, facts, numbersIn([{ submitted: '64' }, { words: 399 }])), []);
  assert.match(validateReport(report, facts, numbersIn([{ submitted: '64' }]))[0], /399/);
});
