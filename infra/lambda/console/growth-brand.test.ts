// Run: cd infra && npx tsx --test lambda/console/growth-brand.test.ts
// Brand kit: focus platforms (owner 2026-11-04: Instagram, Facebook, X first; YouTube later).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_BRAND, readBrand } from './growth-brand';

test('focus platforms: Instagram, Facebook, X by default; known platforms only; never empty', () => {
  assert.deepEqual(DEFAULT_BRAND.focus, ['instagram', 'facebook', 'x']);
  assert.deepEqual(readBrand({ focus: ['x', 'youtube', 'instagram', 'tiktok'] }, DEFAULT_BRAND).focus, ['instagram', 'youtube', 'x']);
  assert.deepEqual(readBrand({ focus: [] }, DEFAULT_BRAND).focus, ['instagram', 'facebook', 'x']);
  assert.deepEqual(readBrand({}, DEFAULT_BRAND).focus, ['instagram', 'facebook', 'x']);
});
