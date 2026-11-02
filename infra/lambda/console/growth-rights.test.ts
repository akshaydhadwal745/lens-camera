// Run: cd infra && npx tsx --test lambda/console/growth-rights.test.ts
// Copyright gate: which licences may appear in posts that promote Lens, and the credits they need.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { creditLine, effectiveStatus, licenseKey, licenseVerdict } from './growth-rights';

test('licences are recognised in their usual spellings', () => {
  assert.equal(licenseKey('CC BY 4.0'), 'cc-by');
  assert.equal(licenseKey('Creative Commons BY-SA 3.0'), 'cc-by-sa');
  assert.equal(licenseKey('cc-by-nc-nd 2.0'), 'cc-by-nc-nd');
  assert.equal(licenseKey('CC0 1.0'), 'public-domain');
  assert.equal(licenseKey('Public Domain Mark'), 'public-domain');
  assert.equal(licenseKey('Unsplash License'), 'unsplash');
  assert.equal(licenseKey('own'), 'own');
  assert.equal(licenseKey('All rights reserved'), 'unknown');
});

test('verdicts', () => {
  const v = (l: string, people = false) => licenseVerdict(l, people).status;
  assert.equal(v('own'), 'cleared');
  assert.equal(v('own', true), 'review');
  assert.equal(v('CC0'), 'cleared');
  assert.equal(v('CC BY 4.0'), 'cleared');
  assert.equal(v('Pexels'), 'cleared');
  assert.equal(v('Unsplash', true), 'review');
  assert.equal(v('CC BY-SA 4.0'), 'review');
  assert.equal(v('CC BY-NC 4.0'), 'blocked');
  assert.equal(v('CC BY-ND 4.0'), 'blocked');
  assert.equal(v('All rights reserved'), 'review');
  assert.equal(v(''), 'review');
  assert.equal(licenseVerdict('CC BY 4.0', false).needsCredit, true);
  assert.equal(licenseVerdict('Pexels', false).needsCredit, false);
});

test('credit lines', () => {
  assert.equal(creditLine('Jane Doe', 'CC BY 4.0', 'https://commons.wikimedia.org/x'), 'Jane Doe, CC BY 4.0 (https://commons.wikimedia.org/x)');
  assert.equal(creditLine('Ravi', 'Unsplash License', 'https://unsplash.com/p'), 'Photo: Ravi on Unsplash');
  assert.equal(creditLine('', 'own', ''), '');
});

test('a person can clear a review, but never a blocked licence', () => {
  const at = Date.now();
  assert.equal(effectiveStatus({ status: 'review', decision: { status: 'cleared', note: 'model release on file', by: 'o', at } }), 'cleared');
  assert.equal(effectiveStatus({ status: 'blocked', decision: { status: 'cleared', note: 'please', by: 'o', at } }), 'blocked');
  assert.equal(effectiveStatus({ status: 'cleared', decision: { status: 'blocked', note: 'wrong licence on source', by: 'o', at } }), 'blocked');
  assert.equal(effectiveStatus({ status: 'review' }), 'review');
});
