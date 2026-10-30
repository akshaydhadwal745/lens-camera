// Run: cd infra && npx tsx --test lambda/api/web-events.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.WEB_ORIGIN = 'https://lens.instagrowapp.com';
const { countersFor, deviceOf } = require('./web-events') as typeof import('./web-events');

const phone = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';

test('first page of a visit: source, landing page, campaign, country and device', () => {
  const c = Object.fromEntries(countersFor({ p: '/guides/x/', v: 1, r: 'https://www.google.com/', m: 'Social', c: 'Diwali-2026' }, { ua: phone, country: 'IN' }));
  assert.deepEqual(c, { 'pv#/guides/x/': 1, visit: 1, 'src#google.com': 1, 'land#/guides/x/': 1, 'dev#mobile': 1, 'cty#IN': 1, 'med#social': 1, 'camp#diwali-2026': 1 });
});

test('later pages count a page view only; country unknown without the edge header', () => {
  assert.deepEqual(countersFor({ p: '/pricing/', v: 0 }, { ua: phone }), [['pv#/pricing/', 1]]);
  assert.ok(countersFor({ p: '/', v: 1 }, { ua: phone }).some(([k]) => k === 'cty#unknown'));
});

test('clicks are counted by page and by the landing page of the visit', () => {
  assert.deepEqual(countersFor({ p: '/download/', e: 'get_lens', l: '/guides/x/' }, { ua: phone }), [
    ['ev#get_lens', 1],
    ['evp#get_lens#/download/', 1],
    ['evl#get_lens#/guides/x/', 1],
  ]);
  assert.deepEqual(countersFor({ p: '/', e: 'not_ours' }, { ua: phone }), [['pv#/', 1]]);
});

test('leaving a page: time is capped, engaged at 10 s, deep scroll at 75 %', () => {
  assert.deepEqual(countersFor({ p: '/', x: 'end', t: 99999, sc: 80 }, { ua: phone }), [['tv#/', 1], ['tsum#/', 1800], ['eng#/', 1], ['sc75#/', 1]]);
  assert.deepEqual(countersFor({ p: '/', x: 'end', t: 4, sc: 10 }, { ua: phone }), [['tv#/', 1], ['tsum#/', 4]]);
  assert.deepEqual(countersFor({ p: '/', x: 'end', t: 'x' }, { ua: phone }), [['tv#/', 1], ['tsum#/', 0]]);
});

test('engaged visit counts once with its landing page; private paths are cut', () => {
  assert.deepEqual(countersFor({ p: '/features/', x: 'engaged', l: '/s/AbCdEf123/' }, { ua: phone }), [['engv', 1], ['engl#/s/', 1]]);
  assert.deepEqual(countersFor({ p: 'https://evil/' }, { ua: phone }), []);
});

test('device type from the user agent', () => {
  assert.equal(deviceOf(phone), 'mobile');
  assert.equal(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130 Safari/537.36'), 'tablet');
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'), 'desktop');
});
