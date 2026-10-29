// Run: cd infra && npx tsx --test lambda/api/play-billing.test.ts
// Google Play Billing: Google's states → the Lens plan, the extra-storage sizes, the free month, the
// account hash and the Pub/Sub push token check.
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { test } from 'node:test';

process.env.QUOTA_BYTES = String(40 * 1024 ** 3);
process.env.TABLE = 'test';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1);

// SSM settings for the push token check (getParam caches what this fake returns).
const AUD = 'https://lens.instagrowapp.com/api/v1/play/rtdn';
const ACCOUNT = 'play-rtdn-push@lens.iam.gserviceaccount.com';
const params: Record<string, string> = { '/lens/play/rtdn-audience': AUD, '/lens/play/push-account': ACCOUNT };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SSMClient } = require('@aws-sdk/client-ssm') as typeof import('@aws-sdk/client-ssm');
SSMClient.prototype.send = (async (cmd: { input: { Name: string } }) => {
  const v = params[cmd.input.Name];
  if (v === undefined) throw Object.assign(new Error('not found'), { name: 'ParameterNotFound' });
  return { Parameter: { Value: v } };
}) as never;

// After the env above (lib.ts reads it when loaded).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pb = require('./play-billing') as typeof import('./play-billing');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const play = require('./play') as typeof import('./play');

type Sub = import('./play').SubscriptionPurchaseV2;
const sub = (state: Sub['subscriptionState'], opts: { expiry?: number; autoRenew?: boolean } = {}): Sub => ({
  subscriptionState: state,
  lineItems: [{ productId: 'lens_plus', expiryTime: new Date(opts.expiry ?? NOW + 20 * DAY).toISOString(), autoRenewingPlan: { autoRenewEnabled: opts.autoRenew ?? true } }],
});

test('active and renewing → plan active', () => {
  assert.equal(pb.plusAction(sub('SUBSCRIPTION_STATE_ACTIVE'), NOW), 'activate');
});

test('active with auto-renew off → active until the paid time ends, marked cancelled', () => {
  assert.equal(pb.plusAction(sub('SUBSCRIPTION_STATE_ACTIVE', { autoRenew: false }), NOW), 'activate-cancelled');
  assert.equal(pb.plusAction(sub('SUBSCRIPTION_STATE_CANCELED'), NOW), 'activate-cancelled');
});

test('cancelled and past its end → back to Free', () => {
  assert.equal(pb.plusAction(sub('SUBSCRIPTION_STATE_CANCELED', { expiry: NOW - DAY }), NOW), 'lapse');
});

test('renewal failing → our grace; on hold, paused, expired → Free; pending → nothing', () => {
  assert.equal(pb.plusAction(sub('SUBSCRIPTION_STATE_IN_GRACE_PERIOD'), NOW), 'grace');
  for (const s of ['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_EXPIRED'] as const) assert.equal(pb.plusAction(sub(s), NOW), 'lapse');
  assert.equal(pb.plusAction(sub('SUBSCRIPTION_STATE_PENDING'), NOW), 'none');
});

test('extra storage: every GB from 4 to 100 has exactly one product and base plan', () => {
  for (let gb = 4; gb <= 100; gb++) {
    const p = pb.extraProductFor(gb)!;
    assert.ok(p, `no product for ${gb} GB`);
    assert.equal(pb.extraGB(p.productId, p.basePlanId), gb);
  }
  assert.equal(pb.extraProductFor(3), undefined);
  assert.equal(pb.extraProductFor(101), undefined);
  assert.equal(pb.extraProductFor(7.5), undefined);
});

test('extra storage: at most 50 base plans per product (Play limit)', () => {
  for (const [lo, hi] of Object.values(pb.EXTRA_PRODUCTS)) assert.ok(hi - lo + 1 <= 50);
});

test('a base plan from the wrong product is refused', () => {
  assert.equal(pb.extraGB('lens_extra_a', 'gb60'), undefined);
  assert.equal(pb.extraGB('lens_extra_b', 'gb20'), undefined);
  assert.equal(pb.extraGB('lens_plus', 'gb20'), undefined);
});

test('the free month: only in the last 30 days of the welcome', () => {
  assert.equal(pb.trialEligible({ welcomeUntil: NOW + 60 * DAY }, NOW), false);
  assert.equal(pb.trialEligible({ welcomeUntil: NOW + 20 * DAY }, NOW), true);
  assert.equal(pb.trialEligible({ welcomeUntil: NOW - DAY }, NOW), false);
});

test('account hash: stable, 64 hex characters (Play limit), different per account', () => {
  assert.equal(pb.accountHash('abc'), pb.accountHash('abc'));
  assert.match(pb.accountHash('abc'), /^[0-9a-f]{64}$/);
  assert.notEqual(pb.accountHash('abc'), pb.accountHash('abd'));
});

test('product kinds', () => {
  assert.equal(pb.kindOf('lens_plus'), 'plus');
  assert.equal(pb.kindOf('lens_extra_b'), 'extra');
  assert.equal(pb.kindOf('move_25gb'), 'move');
  assert.equal(pb.kindOf('something_else'), undefined);
});

test('money from Google: units + nanos → paise', () => {
  assert.equal(play.moneyPaise({ currencyCode: 'INR', units: '59', nanos: 0 }), 5900);
  assert.equal(play.moneyPaise({ currencyCode: 'INR', units: '41', nanos: 580_000_000 }), 4158);
  assert.equal(play.moneyPaise(undefined), undefined);
});

// ---------- the Pub/Sub push token ----------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', alg: 'RS256', use: 'sig' };
function token(claims: Record<string, unknown>, kid = 'k1') {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc(claims)}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url')}`;
}
const good = () => ({ iss: 'https://accounts.google.com', aud: AUD, exp: Math.floor(Date.now() / 1000) + 600, email: ACCOUNT, email_verified: true });

globalThis.fetch = (async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })) as typeof fetch;

test('push token: Google-signed for our audience and account → accepted', async () => {
  assert.equal(await play.verifyPushToken(`Bearer ${token(good())}`), true);
});

test('push token: wrong audience, account, issuer, expired, unknown key or no token → refused', async () => {
  assert.equal(await play.verifyPushToken(`Bearer ${token({ ...good(), aud: 'https://evil.example' })}`), false);
  assert.equal(await play.verifyPushToken(`Bearer ${token({ ...good(), email: 'someone@else.com' })}`), false);
  assert.equal(await play.verifyPushToken(`Bearer ${token({ ...good(), iss: 'https://evil.example' })}`), false);
  assert.equal(await play.verifyPushToken(`Bearer ${token({ ...good(), exp: Math.floor(Date.now() / 1000) - 10 })}`), false);
  assert.equal(await play.verifyPushToken(`Bearer ${token({ ...good(), email_verified: false })}`), false);
  assert.equal(await play.verifyPushToken(`Bearer ${token(good(), 'other-key')}`), false);
  assert.equal(await play.verifyPushToken(undefined), false);
});

test('push token: a token signed by a different key is refused', async () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', kid: 'k1' })}.${enc(good())}`;
  const forged = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(other).toString('base64url')}`;
  assert.equal(await play.verifyPushToken(`Bearer ${forged}`), false);
});
