// Run: cd infra && npx tsx --test lambda/console/growth-competitors.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffSnapshots, summarizeHome, urlHash, type Snapshot } from './growth-competitors';

const html = (title: string, h1: string, body: string) => `<html><head><title>${title}</title><meta name="description" content="Free storage"></head><body><h1>${h1}</h1><p>${body}</p></body></html>`;

test('a homepage summary: title, description, headings, real prices only', () => {
  const s = summarizeHome(html('Degoo', '100 GB free', 'Pro is $2.99/mo or ₹499 a year. Our users 18 million. INR 99 plan. Rs. 12 trial'));
  assert.equal(s.title, 'Degoo');
  assert.equal(s.description, 'Free storage');
  assert.deepEqual(s.headings, ['100 GB free']);
  assert.deepEqual(s.prices, ['$2.99/mo', '₹499', 'INR 99', 'Rs. 12']);
  assert.equal(s.needsBrowser, false);
  assert.equal(summarizeHome('<html><head></head><body><div id="root"></div><script src="a.js"></script></body></html>').needsBrowser, true);
});

test('changes and new pages between weeks; nothing on the first snapshot', () => {
  const snap = (title: string, h1: string, price: string, urls: string[]): Snapshot => ({ ...summarizeHome(html(title, h1, price)), status: 200, sitemapUrls: urls.length, urls });
  const a = snap('Kululu', 'Event photos', '$49', ['https://k.com/a', 'https://k.com/b']);
  const b = snap('Kululu: weddings', 'Event photos', '$59', ['https://k.com/a', 'https://k.com/b', 'https://k.com/weddings-india']);
  assert.deepEqual(diffSnapshots(undefined, a), { changes: [], newPages: [] });
  const d = diffSnapshots(a, b, a.urls.map(urlHash));
  assert.deepEqual(d.newPages, ['https://k.com/weddings-india']);
  assert.match(d.changes.join('\n'), /Title: "Kululu" → "Kululu: weddings"/);
  assert.match(d.changes.join('\n'), /now \$59; no longer \$49/);
  assert.match(d.changes.join('\n'), /Sitemap: 2 → 3 pages/);
  assert.deepEqual(diffSnapshots(a, { ...b, error: 'timeout' }), { changes: ["Couldn't load: timeout"], newPages: [] });
});

test('headings skip accessibility links; prices drop trailing punctuation', () => {
  const s = summarizeHome('<html><head><title>A</title></head><body><h2>Skip to main content</h2><h1>Amazon Photos</h1><p>Plans from $1.99/mo, or $35, yearly.</p></body></html>');
  assert.deepEqual(s.headings, ['Amazon Photos']);
  assert.deepEqual(s.prices, ['$1.99/mo', '$35']);
});
