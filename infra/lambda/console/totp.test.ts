// RFC 6238 appendix B (SHA-1 secret "12345678901234567890"), last 6 digits.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { base32, codeAt, fromBase32, verify } from './totp';

const secret = base32(Buffer.from('12345678901234567890'));

test('RFC 6238 vectors', () => {
  for (const [t, code] of [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ] as const) {
    assert.equal(codeAt(secret, Math.floor(t / 30)), code);
  }
});

test('base32 round trip', () => {
  assert.equal(fromBase32(secret).toString(), '12345678901234567890');
});

test('verify: drift, replay and junk', () => {
  const now = 1111111111 * 1000;
  const step = Math.floor(now / 30000);
  assert.equal(verify(secret, codeAt(secret, step), 0, now), step);
  assert.equal(verify(secret, codeAt(secret, step - 1), 0, now), step - 1);
  assert.equal(verify(secret, codeAt(secret, step - 2), 0, now), null);
  assert.equal(verify(secret, codeAt(secret, step), step, now), null); // used already
  assert.equal(verify(secret, '12345', 0, now), null);
  assert.equal(verify(secret, 'abcdef', 0, now), null);
});
