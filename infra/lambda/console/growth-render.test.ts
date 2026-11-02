// Run: cd infra && npx tsx --test lambda/console/growth-render.test.ts
// A rendered competitor page may load scripts from anywhere public, never from inside the Lambda.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { privateHost } from './growth-render';

test('private, loopback and metadata addresses are blocked', () => {
  for (const h of ['localhost', '127.0.0.1', '127.0.0.53', '169.254.169.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.2.254', '100.64.0.1', '0.0.0.0', '::1', '[::1]', 'fd00::1', 'fe80::1', 'metadata.google.internal'])
    assert.equal(privateHost(h), true, h);
});

test('public hosts are allowed', () => {
  for (const h of ['www.terabox.com', '1024terabox.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', '172.15.0.1'])
    assert.equal(privateHost(h), false, h);
});
