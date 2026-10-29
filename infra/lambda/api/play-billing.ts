// Google Play Billing for the Play Store app (docs/design/play-billing.md). The website and the website
// APK keep Razorpay (payments.ts); both end in PROFILE.plan (plans.ts), so storage, grace, reminders,
// the console and the affiliates don't care who took the money.
//
//   lens_plus                    Lens Plus 50 GB: base plans `monthly` ₹59, `yearly` ₹499; offer
//                                `welcome-trial` (1 month free) in the last 30 days of the welcome.
//   lens_extra_a / lens_extra_b  extra storage above Plus, one base plan per GB (`gb4`…`gb50`,
//                                `gb51`…`gb100`) at GB × ₹3 a month (Play allows 50 active base plans
//                                per subscription, hence two products).
//   move_25gb / move_100gb       one-time packs of "Move to my Google Drive" credit (₹15 a GB).
//
// Google is the source of truth: the app posts the purchase token, Google's real-time notifications
// (Pub/Sub push → POST /v1/play/rtdn) and a daily sweep all re-read the purchase from the Play
// Developer API and move the plan to match. Purchases carry obfuscatedAccountId = accountHash(id) so a
// token can't be claimed by another Lens account.
//
// Records: PLAY#<sha256(token)>/TOKEN → { accountId, productId, kind, token, … } (one per purchase);
// PLAYACC#<accountHash>/ACCOUNT → { accountId } (notifications for purchases the app never posted);
// PROFILE.playTokens = { plus?, extra? } (the current subscriptions, for the daily sweep).
import { createHash } from 'node:crypto';

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { recordPurchase, recordRefund } from './affiliates';
import { audit } from './audit';
import type { ExtraState } from './extra-storage';
import type { Identity } from './identity';
import { ddb, env, HttpError, inWelcome, json, Req, Res } from './lib';
import { activatePlan, cancelPlan, getPlan, lapsePlan, paymentFailed, planActive, type PlanState } from './plans';
import { moneyPaise, PACKAGE, play, playConfigured, type ProductPurchase, type SubscriptionPurchaseV2, verifyPushToken } from './play';

const DAY = 86_400_000;
const GB = 1024 ** 3;

export const PLUS_PRODUCT = 'lens_plus';
export const EXTRA_PRODUCTS = { lens_extra_a: [4, 50], lens_extra_b: [51, 100] } as const;
export const MOVE_PACKS: Record<string, number> = { move_25gb: 25, move_100gb: 100 };
export const TRIAL_OFFER = 'welcome-trial';
/** The free month is offered from this long before the welcome storage ends. */
export const TRIAL_FROM_MS = 30 * DAY;
/** Prices (GST included) for the affiliates when Google's answer has none (e.g. a renewal). */
const LIST_PAISE: Record<string, number> = { monthly: 5_900, yearly: 49_900 };
const PLAY_FEE = 0.15;

type Kind = 'plus' | 'extra' | 'move';
type TokenRow = { accountId: string; productId: string; kind: Kind; token: string; orderId?: string; creditedGB?: number; createdAt: number; updatedAt: number };
type PlayTokens = { plus?: string; extra?: string };

export const accountHash = (accountId: string) => createHash('sha256').update(`lens-account:${accountId}`).digest('hex');
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const planRef = (token: string) => `play:${tokenHash(token).slice(0, 24)}`;
const tokenKey = (token: string) => ({ pk: `PLAY#${tokenHash(token)}`, sk: 'TOKEN' });
const profileKey = (id: string) => ({ pk: `D#${id}`, sk: 'PROFILE' });

export function kindOf(productId: string): Kind | undefined {
  if (productId === PLUS_PRODUCT) return 'plus';
  if (productId in EXTRA_PRODUCTS) return 'extra';
  if (productId in MOVE_PACKS) return 'move';
  return undefined;
}

/** `gb37` on lens_extra_a → 37 (undefined if the base plan doesn't belong to that product). */
export function extraGB(productId: string, basePlanId: string | undefined): number | undefined {
  const range = EXTRA_PRODUCTS[productId as keyof typeof EXTRA_PRODUCTS];
  const gb = Number(/^gb(\d+)$/.exec(basePlanId ?? '')?.[1]);
  return range && gb >= range[0] && gb <= range[1] ? gb : undefined;
}

/** Which product and base plan sells `gb` of extra storage on Play (4–100 GB). */
export function extraProductFor(gb: number): { productId: string; basePlanId: string } | undefined {
  for (const [productId, [lo, hi]] of Object.entries(EXTRA_PRODUCTS)) if (Number.isInteger(gb) && gb >= lo && gb <= hi) return { productId, basePlanId: `gb${gb}` };
  return undefined;
}

/** The free month: once, in the last 30 days of the welcome storage (Play also checks "new customers only"). */
export const trialEligible = (identity: Pick<Identity, 'welcomeUntil'>, now = Date.now()) =>
  inWelcome(identity, now) && (identity.welcomeUntil ?? 0) - now <= TRIAL_FROM_MS;

/** What the Play app needs to sell (GET /v1/play). */
export async function getPlay(identity: Identity): Promise<Res> {
  const now = Date.now();
  const available = !!identity.email && (await playConfigured());
  const hash = accountHash(identity.id);
  // So notifications for a purchase the app never posted (crash, lost network) still find the account.
  if (identity.email) await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `PLAYACC#${hash}`, sk: 'ACCOUNT', accountId: identity.id } }));
  const plan = identity.plan && planActive(identity.plan, now) ? identity.plan : undefined;
  return json(200, {
    available,
    signedIn: !!identity.email,
    accountHash: hash,
    plus: { productId: PLUS_PRODUCT, basePlans: ['monthly', 'yearly'], trialOffer: trialEligible(identity, now) ? TRIAL_OFFER : undefined },
    extra: { products: EXTRA_PRODUCTS, capGB: identity.extra?.provider === 'play' ? identity.extra.capGB : 0 },
    move: MOVE_PACKS,
    plan: plan ? { id: plan.id, status: plan.status, periodEnd: plan.periodEnd, cancelled: plan.cancelled, provider: plan.provider } : undefined,
    // Lens Plus bought on the website: the Play app must not sell a second one.
    otherProvider: plan && plan.provider !== 'play' && !plan.cancelled ? plan.provider : undefined,
    tokens: (identity as Identity & { playTokens?: PlayTokens }).playTokens,
  });
}

async function readSubscription(token: string) {
  return play<SubscriptionPurchaseV2>('GET', `/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`);
}

async function getTokenRow(token: string): Promise<TokenRow | undefined> {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: tokenKey(token) }))).Item as TokenRow | undefined;
}

/** Ties a token to an account (first come; a token can never move to another account). */
async function claimToken(token: string, accountId: string, productId: string, kind: Kind, now: number): Promise<TokenRow> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: env.table,
        Item: { ...tokenKey(token), accountId, productId, kind, token, createdAt: now, updatedAt: now },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
  }
  const row = (await getTokenRow(token))!;
  if (row.accountId !== accountId) throw new HttpError(403, 'This purchase belongs to another Lens account.', 'account-mismatch');
  return row;
}

async function setPlayToken(accountId: string, slot: keyof PlayTokens, token: string | undefined) {
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: profileKey(accountId),
      UpdateExpression: token ? 'SET playTokens = if_not_exists(playTokens, :e), playTokens.#k = :t' : 'REMOVE playTokens.#k',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#k': slot },
      ...(token ? { ExpressionAttributeValues: { ':e': {}, ':t': token } } : {}),
    }),
  );
}

type PlusAction = 'activate' | 'activate-cancelled' | 'grace' | 'lapse' | 'none';

/** Google's subscription state → what happens to the Lens plan (pure; unit-tested). */
export function plusAction(s: SubscriptionPurchaseV2, now = Date.now()): PlusAction {
  const item = s.lineItems?.[0];
  const expiry = item?.expiryTime ? Date.parse(item.expiryTime) : 0;
  switch (s.subscriptionState) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return item?.autoRenewingPlan?.autoRenewEnabled === false ? 'activate-cancelled' : 'activate';
    case 'SUBSCRIPTION_STATE_CANCELED':
      // Auto-renew off: paid time runs to its end.
      return expiry > now ? 'activate-cancelled' : 'lapse';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'grace';
    case 'SUBSCRIPTION_STATE_ON_HOLD':
    case 'SUBSCRIPTION_STATE_PAUSED':
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'lapse';
    default:
      return 'none'; // pending: nothing paid yet
  }
}

/** Moves the account to match one Lens Plus subscription read from Google. */
async function applyPlus(accountId: string, token: string, s: SubscriptionPurchaseV2, actor: string, now = Date.now()) {
  const ref = planRef(token);
  const item = s.lineItems?.[0];
  const periodEnd = item?.expiryTime ? Date.parse(item.expiryTime) : 0;
  const action = plusAction(s, now);
  const plan = await getPlan(accountId);
  const ours = plan?.ref === ref;
  if (action === 'activate' || action === 'activate-cancelled') {
    if (plan && planActive(plan, now) && plan.provider === 'razorpay' && !plan.cancelled) {
      // Both: shouldn't happen (the app hides Play while a website plan runs). Google already charged,
      // so the Play plan wins; support cancels the Razorpay one.
      await audit({ entity: `plan:${accountId}`, action: 'play.conflict', actor, data: { razorpay: plan.ref, play: ref } });
    }
    if (!ours || plan!.status !== 'active' || plan!.periodEnd !== periodEnd) {
      await activatePlan(accountId, { id: 'plus50', periodEnd, provider: 'play', ref }, actor);
      await setPlayToken(accountId, 'plus', token);
      // Affiliates: each paid order once (a free-trial month has no payment).
      const orderId = item?.latestSuccessfulOrderId ?? s.latestOrderId;
      if (orderId && !item?.offerPhase?.freeTrial) {
        const gross = moneyPaise(item?.autoRenewingPlan?.recurringPrice) ?? LIST_PAISE[item?.offerDetails?.basePlanId ?? 'monthly'] ?? 5_900;
        await recordPurchase({ orderId: `play:${orderId}`, userId: accountId, grossPaise: gross, taxPaise: Math.round((gross * 18) / 118), feePaise: Math.round((gross * 100) / 118 * PLAY_FEE), product: `play:${item?.offerDetails?.basePlanId ?? 'plus'}` }).catch((e) =>
          console.error('commission', e),
        );
      }
    }
    if (action === 'activate-cancelled' && !(await getPlan(accountId))?.cancelled) await cancelPlan(accountId, actor);
  } else if (action === 'grace') {
    if (ours && plan!.status === 'active') await paymentFailed(accountId, actor, now);
  } else if (action === 'lapse') {
    if (ours && plan!.status !== 'lapsed') await lapsePlan(accountId, actor, now);
  }
}

/** Extra storage bought on Play: the base plan is the cap (no metering, Google already charged). */
async function applyExtra(accountId: string, productId: string, token: string, s: SubscriptionPurchaseV2, actor: string, now = Date.now()) {
  const item = s.lineItems?.[0];
  const gb = extraGB(productId, item?.offerDetails?.basePlanId);
  const ref = planRef(token);
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: profileKey(accountId), ProjectionExpression: 'extra' }))).Item as { extra?: ExtraState } | undefined;
  const before = p?.extra;
  const action = plusAction(s, now);
  const keep = action === 'activate' || action === 'activate-cancelled' || action === 'grace';
  let next: ExtraState | undefined;
  if (keep && gb) {
    if (before?.provider === 'play' && before.ref === ref && before.capGB === gb) return;
    next = { capGB: gb, meterFrom: now, gbDays: 0, periodCapGB: gb, provider: 'play', ref, agreedAt: now, updatedAt: now };
    await setPlayToken(accountId, 'extra', token);
  } else if (before?.provider === 'play' && before.ref === ref && before.capGB) {
    next = { ...before, capGB: 0, periodCapGB: 0, updatedAt: now };
  }
  if (!next) return;
  await ddb.send(
    new UpdateCommand({ TableName: env.table, Key: profileKey(accountId), UpdateExpression: 'SET #e = :e', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeNames: { '#e': 'extra' }, ExpressionAttributeValues: { ':e': next } }),
  );
  await audit({ entity: `plan:${accountId}`, action: next.capGB ? 'extra.play' : 'extra.off', actor, data: { from: before?.capGB ?? 0, to: next.capGB, product: productId } });
}

async function acknowledge(productId: string, token: string, s: SubscriptionPurchaseV2) {
  if (s.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_PENDING' || s.subscriptionState !== 'SUBSCRIPTION_STATE_ACTIVE') return;
  // Unacknowledged purchases are refunded by Google after 3 days.
  await play('POST', `/purchases/subscriptions/${productId}/tokens/${encodeURIComponent(token)}:acknowledge`, {});
}

/** Reads a subscription token from Google and applies it to its account. */
export async function syncSubscription(accountId: string, productId: string, token: string, actor: string) {
  const s = await readSubscription(token);
  if (!s) return undefined;
  const kind = kindOf(productId);
  if (kind === 'plus') await applyPlus(accountId, token, s, actor);
  else if (kind === 'extra') await applyExtra(accountId, productId, token, s, actor);
  await acknowledge(productId, token, s);
  return s;
}

/** A "Move to Google Drive" pack: credit once, then consume so it can be bought again. */
async function creditMovePack(accountId: string, productId: string, token: string, actor: string): Promise<'credited' | 'already' | 'pending'> {
  const p = await play<ProductPurchase>('GET', `/purchases/products/${productId}/tokens/${encodeURIComponent(token)}`);
  if (!p) throw new HttpError(404, 'Google Play doesn’t know this purchase.', 'unknown-purchase');
  if (p.obfuscatedExternalAccountId && p.obfuscatedExternalAccountId !== accountHash(accountId)) throw new HttpError(403, 'This purchase belongs to another Lens account.', 'account-mismatch');
  if (p.purchaseState === 2) return 'pending';
  if (p.purchaseState !== 0) throw new HttpError(409, 'This purchase was cancelled.', 'cancelled');
  const gb = MOVE_PACKS[productId] * Math.max(1, p.quantity ?? 1);
  const now = Date.now();
  await claimToken(token, accountId, productId, 'move', now);
  // Credit exactly once (the row remembers it), even if the app and a notification race.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: tokenKey(token),
        UpdateExpression: 'SET creditedGB = :g, orderId = :o, updatedAt = :n',
        ConditionExpression: 'attribute_not_exists(creditedGB)',
        ExpressionAttributeValues: { ':g': gb, ':o': p.orderId ?? null, ':n': now },
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
    if (p.consumptionState === 0) await play('POST', `/purchases/products/${productId}/tokens/${encodeURIComponent(token)}:consume`, {});
    return 'already';
  }
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: profileKey(accountId), UpdateExpression: 'ADD moveCreditBytes :b', ExpressionAttributeValues: { ':b': gb * GB } }));
  if (p.consumptionState === 0) await play('POST', `/purchases/products/${productId}/tokens/${encodeURIComponent(token)}:consume`, {});
  await audit({ entity: `plan:${accountId}`, action: 'move.credit', actor, data: { gb, product: productId, order: p.orderId } });
  const gross = gb * 1_500;
  if (p.orderId) await recordPurchase({ orderId: `play:${p.orderId}`, userId: accountId, grossPaise: gross, taxPaise: Math.round((gross * 18) / 118), feePaise: Math.round((gross * 100) / 118 * PLAY_FEE), product: productId }).catch((e) => console.error('commission', e));
  return 'credited';
}

/** POST /v1/play/purchase {productId, purchaseToken}: the app finished a Google purchase. */
export async function postPurchase(identity: Identity, req: Req): Promise<Res> {
  if (!identity.email) throw new HttpError(403, 'Sign in first', 'sign-in');
  const productId = String(req.body?.productId ?? '');
  const token = String(req.body?.purchaseToken ?? '');
  const kind = kindOf(productId);
  if (!kind || !token || token.length > 4096) throw new HttpError(400, 'Unknown purchase');
  if (kind === 'move') {
    const result = await creditMovePack(identity.id, productId, token, identity.id);
    return json(200, { ok: true, result });
  }
  const s = await readSubscription(token);
  if (!s) throw new HttpError(404, 'Google Play doesn’t know this purchase.', 'unknown-purchase');
  if (s.lineItems?.[0]?.productId !== productId) throw new HttpError(400, 'Unknown purchase');
  const owner = s.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (owner && owner !== accountHash(identity.id)) throw new HttpError(403, 'This purchase belongs to another Lens account.', 'account-mismatch');
  await claimToken(token, identity.id, productId, kind, Date.now());
  if (kind === 'plus') await applyPlus(identity.id, token, s, identity.id);
  else await applyExtra(identity.id, productId, token, s, identity.id);
  await acknowledge(productId, token, s);
  return getPlay({ ...identity, plan: await getPlan(identity.id) });
}

/** The account for a token: our row, else the purchase's account hash (purchase never posted). */
async function accountFor(token: string, hash?: string): Promise<string | undefined> {
  const row = await getTokenRow(token);
  if (row) return row.accountId;
  if (!hash) return undefined;
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `PLAYACC#${hash}`, sk: 'ACCOUNT' } }))).Item?.accountId as string | undefined;
}

type Notification = {
  packageName?: string;
  subscriptionNotification?: { notificationType: number; purchaseToken: string; subscriptionId: string };
  oneTimeProductNotification?: { notificationType: number; purchaseToken: string; sku: string };
  voidedPurchaseNotification?: { purchaseToken: string; orderId: string; productType: number; refundType?: number };
  testNotification?: object;
};

/** POST /v1/play/rtdn (public, Pub/Sub push with a Google OIDC token). */
export async function rtdn(req: Req): Promise<Res> {
  if (!(await verifyPushToken(req.headers.authorization))) throw new HttpError(401, 'Bad token');
  const data = req.body?.message?.data as string | undefined;
  const n = data ? (JSON.parse(Buffer.from(data, 'base64').toString()) as Notification) : undefined;
  if (!n || n.packageName !== PACKAGE || n.testNotification) return json(200, { ok: true });

  if (n.subscriptionNotification) {
    const { purchaseToken: token, subscriptionId: productId } = n.subscriptionNotification;
    const kind = kindOf(productId);
    if (kind === 'plus' || kind === 'extra') {
      const s = await readSubscription(token);
      const accountId = s && (await accountFor(token, s.externalAccountIdentifiers?.obfuscatedExternalAccountId));
      if (s && accountId) {
        await claimToken(token, accountId, productId, kind, Date.now());
        if (kind === 'plus') await applyPlus(accountId, token, s, 'play-rtdn');
        else await applyExtra(accountId, productId, token, s, 'play-rtdn');
        await acknowledge(productId, token, s);
      }
    }
  }
  if (n.oneTimeProductNotification?.notificationType === 1) {
    // ONE_TIME_PRODUCT_PURCHASED
    const { purchaseToken: token, sku } = n.oneTimeProductNotification;
    if (kindOf(sku) === 'move') {
      const p = await play<ProductPurchase>('GET', `/purchases/products/${sku}/tokens/${encodeURIComponent(token)}`);
      const accountId = p && (await accountFor(token, p.obfuscatedExternalAccountId));
      if (accountId) await creditMovePack(accountId, sku, token, 'play-rtdn');
    }
  }
  if (n.voidedPurchaseNotification) await voided(n.voidedPurchaseNotification);
  return json(200, { ok: true });
}

/** A refund or chargeback: the plan ends now; unused move credit from that pack is taken back. */
async function voided(v: NonNullable<Notification['voidedPurchaseNotification']>) {
  const row = await getTokenRow(v.purchaseToken);
  if (!row) return;
  const now = Date.now();
  if (row.kind === 'plus') {
    const plan = await getPlan(row.accountId);
    if (plan?.ref === planRef(row.token) && plan.status !== 'lapsed') await lapsePlan(row.accountId, 'play-refund', now);
  } else if (row.kind === 'extra') {
    const s = await readSubscription(row.token);
    if (s) await applyExtra(row.accountId, row.productId, row.token, { ...s, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }, 'play-refund');
  } else if (row.creditedGB) {
    const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: profileKey(row.accountId), ProjectionExpression: 'moveCreditBytes' }))).Item;
    const take = Math.min(row.creditedGB * GB, Math.max(0, Number(p?.moveCreditBytes ?? 0)));
    if (take) await ddb.send(new UpdateCommand({ TableName: env.table, Key: profileKey(row.accountId), UpdateExpression: 'ADD moveCreditBytes :b', ExpressionAttributeValues: { ':b': -take } }));
  }
  await recordRefund(`play:${v.orderId}`, now).catch((e) => console.error('refund', e));
  await audit({ entity: `plan:${row.accountId}`, action: 'play.refunded', actor: 'play-rtdn', data: { product: row.productId, order: v.orderId } });
}

/**
 * Daily backstop (Maintenance): re-reads every Play subscription still giving storage, in case a
 * notification was lost. Cheap: one API call per paying Play account a day.
 */
export async function sweepPlay(rows: { id: string; plan?: PlanState; extra?: ExtraState; playTokens?: PlayTokens }[]) {
  if (!(await playConfigured())) return 0;
  let n = 0;
  for (const r of rows) {
    const t = r.playTokens;
    if (!t) continue;
    const plusDue = t.plus && r.plan?.provider === 'play' && r.plan.status !== 'lapsed';
    const extraDue = t.extra && r.extra?.provider === 'play' && r.extra.capGB > 0;
    try {
      if (plusDue) await syncSubscription(r.id, PLUS_PRODUCT, t.plus!, 'system');
      if (extraDue) {
        const row = await getTokenRow(t.extra!);
        if (row) await syncSubscription(r.id, row.productId, t.extra!, 'system');
      }
      if (plusDue || extraDue) n++;
    } catch (e) {
      console.error('play sweep', r.id, e);
    }
  }
  return n;
}
