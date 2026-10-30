// Run: cd infra && npx tsx --test lambda/console/growth-seo.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditHtml, auditScore, linksToUs, sitemapLocs } from './growth-seo';

const page = (head: string, body: string) => `<!doctype html><html lang="en"><head>${head}</head><body><main>${body}</main></body></html>`;
const goodHead = '<title>Free full-quality photo and video backup | Lens</title><meta name="description" content="Back up every photo and video byte for byte, no compression. 40 GB free for 3 months, then 10 GB free."><link rel="canonical" href="https://lens.instagrowapp.com/features/x/"><link rel="alternate" hreflang="en" href="a"><link rel="alternate" hreflang="hi" href="b"><link rel="alternate" hreflang="x-default" href="c"><meta property="og:image" content="x"><script type="application/ld+json">{}</script>';
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('a healthy page has no issues', () => {
  const a = auditHtml('/features/x/', page(goodHead, `<h1>Backup</h1><p>${words(400)}</p><img src="a" alt="b"><a href="/pricing/">p</a>`));
  assert.deepEqual(a.issues, []);
  assert.deepEqual(a.internalLinks, ['/pricing/']);
  assert.equal(a.words > 300, true);
});

test('finds the problems that cost rankings, with severity', () => {
  const a = auditHtml('/features/x/', page('<title>x</title><meta name="robots" content="noindex">', `<h1>a</h1><h1>b</h1><p>${words(50)}</p><img src="a">`));
  const codes = a.issues.map((i) => `${i.code}:${i.severity}`);
  for (const c of ['title-short:info', 'description-missing:error', 'h1-many:warn', 'noindex:error', 'canonical-missing:warn', 'hreflang-missing:warn', 'thin:warn', 'img-alt:warn', 'jsonld-missing:info'])
    assert.ok(codes.includes(c), c);
  assert.match(auditHtml('/x/', page(goodHead.replace('features/x/', 'other/'), `<h1>a</h1><p>${words(400)}</p>`)).issues.map((i) => i.message).join(), /Canonical points elsewhere/);
  assert.equal(auditHtml('/x/', '', 404).issues[0].code, 'status');
});

test('health score and sitemap parsing', () => {
  assert.equal(auditScore([{ issues: [] }, { issues: [{ code: 'a', severity: 'error', message: '' }, { code: 'b', severity: 'warn', message: '' }] }]), 94);
  assert.deepEqual(sitemapLocs('<urlset><url><loc>https://lens.instagrowapp.com/</loc></url><url><loc> https://lens.instagrowapp.com/hi/ </loc></url></urlset>'), ['https://lens.instagrowapp.com/', 'https://lens.instagrowapp.com/hi/']);
});

test('a prospect counts as live only if the page links to our site', () => {
  assert.equal(linksToUs('<a href="https://lens.instagrowapp.com/">Lens</a>'), true);
  assert.equal(linksToUs('<p>lens.instagrowapp.com</p>'), false);
  assert.equal(linksToUs('<a href="https://evil-lens.instagrowapp.com.example/">x</a>'), false);
  assert.equal(linksToUs('<a href="https://lens.instagrowapp.com.example/">x</a>'), false);
  assert.equal(linksToUs('<a href="https://instagrowapp.com">x</a>'), true);
});
