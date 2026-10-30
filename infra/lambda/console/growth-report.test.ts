// Run: cd infra && npx tsx --test lambda/console/growth-report.test.ts
// Growth facts and the weekly report: numbers computed by code, findings by rules, and the check that
// rejects analyst text with numbers it didn't take from a cited fact.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fact, indexFacts, notable, productFacts, searchFacts, weekOverWeek, type SearchDay } from './growth-facts';
import { ruleFindings, unsupportedNumbers, validateReport, type AiReport } from './growth-report';

const day = (i: number, rows: SearchDay['rows']): SearchDay => ({ day: `d${i}`, rows });
const days = (rowsFor: (i: number) => SearchDay['rows']) => Array.from({ length: 56 }, (_, i) => day(i, rowsFor(i)));

test('search totals compare the last 28 days with the 28 before', () => {
  const f = searchFacts(days((i) => [{ sk: 'total', clicks: i < 28 ? 1 : 2, impressions: 100, position: i < 28 ? 20 : 10 }]));
  const get = (id: string) => f.find((x) => x.id === id)!;
  assert.deepEqual([get('search.clicks').value, get('search.clicks').previous, get('search.clicks').change], [56, 28, 1]);
  assert.equal(get('search.ctr').value, 0.02);
  assert.equal(get('search.position').value, 10);
  assert.equal(get('search.position').previous, 20);
});

test('query movers, low-CTR pages and page-two queries', () => {
  const f = searchFacts(
    days((i) =>
      i < 28
        ? [{ sk: 'q#old query', clicks: 0, impressions: 5, position: 30 }]
        : [
            { sk: 'q#phone storage full', clicks: 0, impressions: 3, position: 12 },
            { sk: 'p#/guides/x/', clicks: 0, impressions: 4, position: 9 },
          ],
    ),
  );
  const ids = f.map((x) => x.id);
  assert.ok(ids.includes('search.gaining.1'));
  assert.ok(ids.includes('search.losing.1'));
  assert.equal(f.find((x) => x.id === 'search.gaining.1')!.label, 'Query gaining impressions: "phone storage full"');
  assert.equal(f.find((x) => x.id === 'search.lowctr.1.ctr')!.value, 0);
  assert.equal(f.find((x) => x.id === 'search.page2.1')!.value, 12);
});

test('no search data: zeros and nulls, no movers', () => {
  const f = searchFacts(days(() => []));
  assert.equal(f.find((x) => x.id === 'search.impressions')!.value, 0);
  assert.equal(f.find((x) => x.id === 'search.ctr')!.value, null);
  assert.equal(f.length, 4);
});

test('week over week and what counts as notable', () => {
  const w = weekOverWeek('web.visits', 'website', 'Website visits', [...Array(7).fill(1), ...Array(7).fill(3)]);
  assert.deepEqual([w.value, w.previous, w.change], [21, 7, 2]);
  assert.equal(notable(w), true);
  assert.equal(notable(weekOverWeek('x', 'app', 'x', [...Array(7).fill(0), 1, 1, 1, 0, 0, 0, 0])), false); // too small
  assert.equal(notable(fact({ id: 'x', area: 'app', label: 'x', value: 12, previous: 10, unit: 'count', window: 'w' })), false);
});

test('product facts from the Console analytics', () => {
  const f = productFacts({
    funnel: [
      { key: 'install', label: '', count: 40 },
      { key: 'upload', label: '', count: 20 },
      { key: 'signin', label: '', count: 10 },
      { key: 'share', label: '', count: 4 },
      { key: 'return', label: '', count: 6 },
    ],
    eligibleForReturn: 30,
    active: { series: Array.from({ length: 14 }, (_, i) => ({ day: `${i}`, dau: 2, wau: 0, mau: 0 })), today: { dau: 2, wau: 9, mau: 30 } },
    channels: [
      { channel: 'google-play / organic', installs: 40, backedUp: { reached: 20, eligible: 40, rate: 0.5 }, signedIn: { reached: 10, eligible: 40, rate: 0.25 }, d1: { reached: 10, eligible: 40, rate: 0.25 }, d7: { reached: 3, eligible: 30, rate: 0.1 }, d30: { reached: 0, eligible: 0, rate: null }, paying: 1, storageGB: 12.5, storageUsdPerMonth: 0.15 },
    ],
    features: [{ name: 'server_invite', users30: 3, uses30: 5 }],
  });
  const v = (id: string) => f.find((x) => x.id === id)!.value;
  assert.equal(v('app.installs'), 40);
  assert.equal(v('app.upload_rate'), 0.5);
  assert.equal(v('app.came_back_7d_rate'), 0.2);
  assert.equal(v('app.retention_d7'), 0.1);
  assert.equal(v('app.retention_d30'), null);
  assert.equal(v('money.paying'), 1);
  assert.equal(v('loops.server_invite'), 3);
  assert.equal(v('loops.event_join'), 0);
});

test('rule findings: indexing, traffic, activation, retention, thin data', () => {
  const facts = [
    ...indexFacts({ urls: 64, indexed: 0, states: { 'URL is unknown to Google': 34 } }),
    fact({ id: 'search.impressions', area: 'search', label: 'x', value: 0, unit: 'count', window: 'w' }),
    fact({ id: 'web.visits_30d', area: 'website', label: 'x', value: 10, unit: 'count', window: 'w' }),
    fact({ id: 'app.installs', area: 'app', label: 'x', value: 40, unit: 'count', window: 'w' }),
    fact({ id: 'app.upload_rate', area: 'app', label: 'x', value: 0.4, unit: 'pct', window: 'w' }),
    fact({ id: 'app.retention_d7', area: 'app', label: 'x', value: 0.1, unit: 'pct', window: 'w' }),
  ];
  const titles = ruleFindings(facts).map((r) => r.title);
  assert.ok(titles.includes('Most website pages are not in Google yet'));
  assert.ok(titles.includes('No search visibility yet'));
  assert.ok(titles.includes('Almost no website traffic'));
  assert.ok(titles.includes('Many installs never back up a photo'));
  assert.ok(titles.includes('Week-one retention is low'));
  assert.ok(!titles.includes('Too few installs to judge activation and retention'));
});

const facts = [
  fact({ id: 'web.visits', area: 'website', label: 'Website visits', value: 21, previous: 7, unit: 'count', window: '7 days vs the 7 before' }),
  fact({ id: 'app.upload_rate', area: 'app', label: 'Installs that backed up', value: 0.456, unit: 'pct', window: '30 days' }),
  fact({ id: 'search.indexed_pages', area: 'search', label: 'Pages Google has indexed', value: 0, unit: 'count', window: 'now' }),
  fact({ id: 'search.sitemap_pages', area: 'search', label: 'Pages in our sitemap', value: 64, unit: 'count', window: 'now' }),
];

test('numbers must come from the cited facts (as is, rounded, or as %/change)', () => {
  assert.deepEqual(unsupportedNumbers('Visits rose from 7 to 21 (+200%), 14 more.', ['web.visits'], facts), []);
  assert.deepEqual(unsupportedNumbers('45.6% of installs backed up (about 46%).', ['app.upload_rate'], facts), []);
  assert.deepEqual(unsupportedNumbers('A rate of 0.456 backed up.', ['app.upload_rate'], facts), []);
  assert.deepEqual(unsupportedNumbers('Visits will reach 500 next month and 1,200 by March.', ['web.visits'], facts), ['500', '1,200']);
  assert.deepEqual(unsupportedNumbers('Only 0 of 64 pages are indexed.', ['search.indexed_pages'], facts), ['64']); // 64 not cited
  assert.deepEqual(unsupportedNumbers('Check again in 2 weeks, by 2026.', [], facts), []); // durations and years
});

test('a whole report: unknown fact ids and invented numbers are reported', () => {
  const good: AiReport = {
    summary: 'Visits went from 7 to 21; Google has indexed 0 of 64 pages.',
    findings: [{ severity: 'high', title: 'Indexing', detail: '0 of 64 pages indexed.', facts: ['search.indexed_pages', 'search.sitemap_pages'] }],
    recommendations: [{ title: 'Request indexing', workstream: 'search', hypothesis: 'Requesting indexing gets key pages indexed within 2 weeks', expectedImpact: 'More indexed pages', effort: 'low', cost: 'Free, 15 minutes', timeToResult: '2–3 weeks', risk: 'None', metric: 'Indexed pages', stopRule: 'If none indexed after 4 weeks, focus on links', facts: ['search.indexed_pages'] }],
    reviewOfPrevious: [],
  };
  assert.deepEqual(validateReport(good, facts), []);
  const bad: AiReport = { ...good, findings: [{ severity: 'low', title: 'Traffic', detail: 'Traffic will triple to 63 visits.', facts: ['web.visit'] }] };
  const problems = validateReport(bad, facts);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /unknown fact id "web.visit"/);
  assert.match(problems[1], /63/);
});

test('opportunity score: relevance × demand × trend × winnability; relevance 0 scores 0', () => {
  const { opportunityScore } = require('./growth-report') as typeof import('./growth-report');
  assert.equal(opportunityScore({ relevance: 3, demand: 'high', trend: 'rising', winnability: 'high' }), 20.3);
  assert.equal(opportunityScore({ relevance: 2, demand: 'unmeasured', trend: 'unknown', winnability: 'medium' }), 0.9);
  assert.equal(opportunityScore({ relevance: 0, demand: 'high', trend: 'rising', winnability: 'high' }), 0);
});

test('product features come from the Features list only', () => {
  const { productFeatures } = require('./growth-report') as typeof import('./growth-report');
  const md = '# x\n## Features\n- **Share links**: a\n- **Event albums**: b\n## Not available\n- **Unlimited storage**: no\n';
  assert.deepEqual(productFeatures(md), ['Share links', 'Event albums']);
});

test('opportunities: invented features, numbers, long titles and bad URLs are caught', () => {
  const { validateReport } = require('./growth-report') as typeof import('./growth-report');
  const { fact } = require('./growth-facts') as typeof import('./growth-facts');
  const facts = [fact({ id: 'demand.bing.us.free_cloud_storage', area: 'demand', label: 'Bing searches', value: 5795, unit: 'count', window: '12 weeks' })];
  const files: Record<string, string> = { 'docs/growth/product-facts.md': '## Features\n- **Share links**: a\n## Not available\n' };
  const brief = { url: '/guides/free-cloud-storage/', title: 'Free cloud storage for photos', metaDescription: 'd', h1: 'h', outline: [], questions: [], supportingKeywords: [], internalLinksFrom: [], internalLinksTo: [], searchResultsToday: 'not checked' };
  const opp = { topic: 't', targetKeyword: 'free cloud storage', intent: 'problem', audience: 'a', lensFeatures: ['Share links'], relevance: 3, relevanceReason: 'r', demand: 'high', demandEvidence: 'Bing shows 5795 searches in the US', trend: 'steady', winnability: 'low', competition: 'c', action: 'new-guide', existingPage: '', brief, businessValue: 'v', measurement: 'm', facts: ['demand.bing.us.free_cloud_storage'] } as const;
  const base = { summary: 's', findings: [], recommendations: [], reviewOfPrevious: [] };
  assert.deepEqual(validateReport({ ...base, opportunities: [opp as any] }, facts, new Set(), (f) => files[f]), []);
  const bad = validateReport(
    { ...base, opportunities: [{ ...opp, lensFeatures: ['Unlimited storage'], demandEvidence: '9000 searches', brief: { ...brief, title: 'x'.repeat(61), url: '/Guides/X' } } as any] },
    facts,
    new Set(),
    (f) => files[f],
  );
  assert.equal(bad.length, 4);
  assert.match(bad.join('\n'), /9000/);
  assert.match(bad.join('\n'), /"Unlimited storage" is not a feature/);
  assert.match(bad.join('\n'), /61 characters/);
  assert.match(bad.join('\n'), /lowercase path/);
});

test('drafts: nothing changed, too many files, wrong paths and forbidden claims are stopped by code', () => {
  const { draftProblems } = require('./growth') as typeof import('./growth');
  const f = (path: string, content: string, before = '') => ({ path, content, before });
  assert.deepEqual(draftProblems([]), ['the draft changed nothing']);
  assert.deepEqual(draftProblems([f('site/src/content/pages.ts', 'Back up with no Lens limit', 'Back up')]), []);
  assert.match(draftProblems([f('site/src/content/pages.ts', 'Unlimited backup', 'Backup')]).join(), /forbids/);
  // An existing claim that stays (not added) is not the draft's fault.
  assert.deepEqual(draftProblems([f('site/src/content/pages.ts', '10 GB free forever. New text.', '10 GB free forever.')]), []);
  assert.deepEqual(draftProblems([f('site/src/content/pages.ts', 'Then 10 GB free forever.', 'Then 10 GB free.')]), []); // allowed since 2026-10-30
  assert.equal(draftProblems([f('site/src/content/pages.ts', 'Unlimited storage.', 'Storage.')]).length, 1);
  assert.match(draftProblems([f('.github/workflows/web.yml', 'x')]).join(), /outside/);
  assert.match(draftProblems(Array.from({ length: 11 }, (_, i) => f(`site/src/content/p${i}.ts`, 'x'))).join(), /max 10/);
});
