// Run: cd infra && npx tsx --test lambda/console/growth-records.test.ts
// Approval stays only while the content is exactly what was approved, whatever order DynamoDB returns keys in.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stable } from './growth-records';

test('content comparison ignores key order and empty values', () => {
  assert.equal(stable({ instagram: { caption: 'a', hashtags: ['#x'] }, facebook: { cta: 'b' } }), stable({ facebook: { cta: 'b' }, instagram: { hashtags: ['#x'], caption: 'a' } }));
  assert.equal(stable(undefined), stable(''));
  assert.notEqual(stable({ caption: 'a' }), stable({ caption: 'b' }));
  assert.notEqual(stable(['#a', '#b']), stable(['#b', '#a']));
});
