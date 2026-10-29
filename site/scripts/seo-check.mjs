// SEO check of the built site (docs/growth/seo-agent.md). Reads site/dist (after `astro build`),
// checks every indexable page and traces each problem to the source line that produces it.
//   node scripts/seo-check.mjs [--json out.json] [--live-index index.json]
// Exit code 1 only for errors (things that can stop a page from being indexed or break it);
// warnings are reported but never fail the build. Passing doesn't mean Google will rank a page.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');
const SITE = 'https://lens.instagrowapp.com';
const PRIVATE = /^\/(app|signin|hi\/signin|l|e|u|s|qr-card|paid)\//;

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

// ---------- helpers ----------
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
const attr = (tag, name) => decode(tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1] ?? '');
const text = (html) =>
  decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();

const srcFiles = [...walk(SRC).filter((f) => /\.(ts|astro|md|mdx|json)$/.test(f)), join(ROOT, 'astro.config.mjs')];
const srcText = new Map(srcFiles.map((f) => [f, readFileSync(f, 'utf8')]));
/** Where a string is written in site/src (first match): "src/content/pages.ts:35". */
function locate(needle) {
  if (!needle || needle.length < 6) return undefined;
  const variants = [needle, needle.replace(/'/g, '’'), needle.replace(/’/g, "'"), needle.replace(/'/g, "\\'")];
  for (const [file, body] of srcText)
    for (const v of variants) {
      const i = body.indexOf(v);
      if (i >= 0) return `site/${relative(ROOT, file)}:${body.slice(0, i).split('\n').length}`;
    }
  return undefined;
}

// ---------- read pages ----------
const htmlFiles = walk(DIST).filter((f) => f.endsWith('index.html') && !relative(DIST, f).startsWith('app/'));
const pages = new Map();
for (const f of htmlFiles) {
  const path = `/${relative(DIST, f).replace(/index\.html$/, '')}`;
  const html = readFileSync(f, 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const body = html.slice(html.indexOf('<body'));
  const main = (body.match(/<main[\s\S]*<\/main>/i) ?? [body])[0];
  const title = decode(head.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '');
  const descTag = head.match(/<meta[^>]+name="description"[^>]*>/i)?.[0];
  const canonTag = head.match(/<link[^>]+rel="canonical"[^>]*>/i)?.[0];
  const robots = head.match(/<meta[^>]+name="robots"[^>]*>/i)?.[0];
  const alternates = [...head.matchAll(/<link[^>]+rel="alternate"[^>]+hreflang[^>]*>/gi)].map((m) => ({ lang: attr(m[0], 'hreflang'), href: attr(m[0], 'href') }));
  const jsonld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const links = [...body.matchAll(/<a\s[^>]*href="([^"#?]*)[^"]*"[^>]*>/gi)].map((m) => m[1]).filter((h) => h.startsWith('/') && !h.startsWith('//'));
  const contentLinks = [...main.matchAll(/<a\s[^>]*href="([^"#?]*)[^"]*"[^>]*>/gi)].map((m) => m[1]).filter((h) => h.startsWith('/') && !h.startsWith('//'));
  pages.set(path, {
    path,
    title,
    description: descTag ? attr(descTag, 'content') : null,
    canonical: canonTag ? attr(canonTag, 'href') : null,
    noindex: robots ? /noindex/i.test(attr(robots, 'content')) : false,
    h1: (body.match(/<h1[\s>]/gi) ?? []).length,
    words: text(main).split(' ').filter(Boolean).length,
    alternates,
    jsonld,
    links,
    contentLinks,
  });
}

const sitemapUrls = (() => {
  const loc = (f) => [...readFileSync(f, 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  const index = join(DIST, 'sitemap-index.xml');
  if (!existsSync(index)) return [];
  return loc(index).flatMap((u) => loc(join(DIST, u.replace(SITE, ''))));
})();
const sitemapAlternates = (() => {
  const f = join(DIST, 'sitemap-0.xml');
  return existsSync(f) ? [...new Set([...readFileSync(f, 'utf8').matchAll(/hreflang="([^"]+)"/g)].map((m) => m[1]))] : [];
})();

// ---------- checks ----------
const findings = [];
const add = (severity, check, page, message, source, evidence) => findings.push({ severity, check, page, message, ...(source ? { source } : {}), ...(evidence ? { evidence } : {}) });
const indexable = [...pages.values()].filter((p) => !PRIVATE.test(p.path) && p.path !== '/404/');

const byTitle = new Map();
const byDesc = new Map();
for (const p of indexable) {
  const bare = p.title.replace(/ \| Lens( by InstaGrow)?$/, '');
  if (!p.title) add('error', 'title', p.path, 'No <title>.');
  else if (p.title.length > 60) add('warn', 'title-length', p.path, `Title is ${p.title.length} characters; Google shows about 60.`, locate(bare), p.title);
  byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p.path]);
  if (!p.description) add('error', 'description', p.path, 'No meta description.');
  else {
    if (p.description.length < 70 || p.description.length > 160) add('warn', 'description-length', p.path, `Description is ${p.description.length} characters (aim for 70–160).`, locate(p.description.slice(0, 60)), p.description);
    byDesc.set(p.description, [...(byDesc.get(p.description) ?? []), p.path]);
  }
  if (p.canonical !== `${SITE}${p.path}`) add('error', 'canonical', p.path, `Canonical is ${p.canonical ?? 'missing'}, expected ${SITE}${p.path}.`);
  if (p.noindex) add('error', 'noindex', p.path, 'Indexable page has noindex.');
  if (p.h1 !== 1) add('warn', 'h1', p.path, `${p.h1} <h1> elements (expected 1).`);
  if (p.words < 300) add('warn', 'thin', p.path, `${p.words} words in the main content.`);
  for (const [i, j] of p.jsonld.entries())
    try {
      JSON.parse(j);
    } catch {
      add('error', 'jsonld', p.path, `Structured data block ${i + 1} is not valid JSON.`);
    }
  // hreflang: every alternate must exist and point back.
  for (const a of p.alternates) {
    const target = a.href.replace(SITE, '');
    if (a.lang === 'x-default') continue;
    const other = pages.get(target);
    if (!other) add('error', 'hreflang', p.path, `hreflang ${a.lang} points to ${target}, which doesn't exist.`);
    else if (!other.alternates.some((b) => b.href === `${SITE}${p.path}`)) add('warn', 'hreflang', p.path, `${target} doesn't link back with hreflang.`);
  }
  for (const l of p.links) {
    const target = l.endsWith('/') ? l : `${l}/`;
    if (/\.[a-z0-9]{2,5}$/i.test(l)) continue; // files (images, apk, xml)
    if (!pages.has(target) && !PRIVATE.test(target) && !target.startsWith('/app/') && !target.startsWith('/api/') && !target.startsWith('/r/') && !target.startsWith('/go/'))
      add('error', 'broken-link', p.path, `Links to ${l}, which isn't a page.`);
  }
}
for (const [t, ps] of byTitle) if (ps.length > 1) add('warn', 'duplicate-title', ps[0], `Same title on ${ps.length} pages: ${ps.join(', ')}.`, undefined, t);
for (const [d, ps] of byDesc) if (ps.length > 1) add('warn', 'duplicate-description', ps[0], `Same description on ${ps.length} pages: ${ps.join(', ')}.`, undefined, d);

// Sitemap ↔ pages.
const inSitemap = new Set(sitemapUrls.map((u) => u.replace(SITE, '')));
for (const u of inSitemap) {
  const p = pages.get(u);
  if (!p) add('error', 'sitemap', u, 'In the sitemap but not built.');
  else if (p.noindex) add('error', 'sitemap', u, 'In the sitemap but noindex.');
}
for (const p of indexable) if (!inSitemap.has(p.path)) add('warn', 'sitemap', p.path, 'Indexable page missing from the sitemap.');

// Internal links from other pages' main content (navigation and footer don't count).
const inbound = new Map(indexable.map((p) => [p.path, new Set()]));
for (const p of indexable) for (const l of p.contentLinks) {
  const t = l.endsWith('/') ? l : `${l}/`;
  if (t !== p.path && inbound.has(t)) inbound.get(t).add(p.path);
}
for (const [path, from] of inbound) if (from.size < 2 && path !== '/' && path !== '/hi/') add('warn', 'internal-links', path, `Linked from ${from.size} other page${from.size === 1 ? '' : 's'}' content (navigation excluded).`, undefined, [...from].join(', ') || 'none');

// Geo signal: a worldwide English site tagged en-IN tells Google the pages are for India.
if (sitemapAlternates.includes('en-IN')) add('warn', 'geo-targeting', '/', 'Sitemap hreflang marks English pages as en-IN (English for India). For a worldwide audience use "en" (and x-default).', locate("en: 'en-IN'"), sitemapAlternates.join(', '));
for (const p of indexable.slice(0, 1)) {
  const tags = p.alternates.map((a) => a.lang);
  if (tags.some((t) => /-IN$/.test(t))) add('warn', 'geo-targeting', p.path, `Page hreflang tags: ${tags.join(', ')}.`, undefined);
}

// Live index status from Search Console (optional): which pages Google hasn't indexed.
const live = opt('--live-index');
if (live && existsSync(live)) {
  const idx = JSON.parse(readFileSync(live, 'utf8'));
  for (const path of idx.notIndexed ?? []) if (pages.has(path)) add('info', 'not-indexed', path, `Google: ${idx.stateOf?.[path] ?? 'not indexed'}.`);
}

// ---------- report ----------
const order = { error: 0, warn: 1, info: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.check.localeCompare(b.check) || a.page.localeCompare(b.page));
const summary = { pages: indexable.length, sitemap: inSitemap.size, errors: findings.filter((f) => f.severity === 'error').length, warnings: findings.filter((f) => f.severity === 'warn').length };
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify({ summary, findings, pages: indexable.map(({ links, contentLinks, jsonld, ...p }) => ({ ...p, inbound: [...(inbound.get(p.path) ?? [])] })) }, null, 1));
const counts = {};
for (const f of findings) counts[`${f.severity} ${f.check}`] = (counts[`${f.severity} ${f.check}`] ?? 0) + 1;
console.log(`SEO check: ${summary.pages} indexable pages, ${summary.sitemap} in the sitemap, ${summary.errors} errors, ${summary.warnings} warnings`);
for (const [k, n] of Object.entries(counts)) console.log(`  ${n} × ${k}`);
for (const f of findings.filter((x) => x.severity === 'error')) console.log(`ERROR ${f.check} ${f.page}: ${f.message}${f.source ? ` (${f.source})` : ''}`);
process.exit(summary.errors ? 1 : 0);
