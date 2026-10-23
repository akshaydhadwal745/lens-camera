// Lens Plus through Razorpay subscriptions: the "Lock in Lens Plus" offer (owner decision 2026-10-21,
// option A; docs/business/payments.md). Website + APK only: the Play Store app must use Play Billing.
//
//   During the welcome: UPI Autopay / card mandate today, nothing charged; the subscription starts
//   when the welcome ends. First month ₹19 (dashboard offer, only while the welcome lasts), then
//   ₹59/month, or ₹499/year. Razorpay sends its pre-debit notice; we remind 3 days before the
//   first charge (lifecycle.ts) and cancelling is one tap (POST /v1/plus/cancel).
//   After the welcome: the subscription starts at once (first charge today, no intro price).
//
// State: PROFILE.sub = { id, kind, status: created | scheduled | active | ended, chargeAt?, intro?,
// paidCount, createdAt, updatedAt }; RZP#<subscription id>/SUB → { accountId } for webhooks.
// Razorpay is the source of truth: the app, the webhook and the 15-minute Maintenance tick all call
// reconcile(), which reads the subscription from Razorpay and moves the plan (plans.ts).
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { recordPurchase } from './affiliates';
import { settleLink } from './drive-move';
import { audit } from './audit';
import { Identity } from './identity';
import { ddb, env, HttpError, inWelcome, json, Req, Res } from './lib';
import { activatePlan, cancelPlan, getPlan, paymentFailed, planActive, PLANS } from './plans';
import { introOfferId, planIds, razorpayConfigured, RzpInvoice, RzpSubscription, rzp, testMode, verifyWebhook } from './razorpay';

const DAY = 86_400_000;

export const OFFERS = {
  'plus50-month': { plan: 'plus50', paise: 5_900, period: 'month' as const, introPaise: 1_900 },
  'plus50-year': { plan: 'plus50', paise: 49_900, period: 'year' as const, introPaise: undefined },
};
export type OfferKind = keyof typeof OFFERS;

export type SubState = {
  id: string;
  kind: OfferKind;
  status: 'created' | 'scheduled' | 'active' | 'ended';
  /** When the first (or next) charge happens (ms). */
  chargeAt?: number;
  /** The first month is ₹19 (lock-in during the welcome, offer configured). */
  intro?: boolean;
  paidCount: number;
  cancelled?: boolean;
  createdAt: number;
  updatedAt: number;
};

const profileKey = (id: string) => ({ pk: `D#${id}`, sk: 'PROFILE' });

async function getSub(accountId: string): Promise<SubState | undefined> {
  const r = await ddb.send(new GetCommand({ TableName: env.table, Key: profileKey(accountId), ProjectionExpression: '#s', ExpressionAttributeNames: { '#s': 'sub' } }));
  return r.Item?.sub as SubState | undefined;
}

async function saveSub(accountId: string, sub: SubState | undefined) {
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: profileKey(accountId),
      UpdateExpression: sub ? 'SET #s = :s' : 'REMOVE #s',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#s': 'sub' },
      ...(sub ? { ExpressionAttributeValues: { ':s': sub } } : {}),
    }),
  );
}

/** Does the welcome leave room for a lock-in (subscription starting when it ends)? */
const lockInStart = (identity: Pick<Identity, 'welcomeUntil'>, now: number) =>
  inWelcome(identity, now) && (identity.welcomeUntil ?? 0) - now > DAY ? identity.welcomeUntil! : undefined;

function subForClient(sub: SubState | undefined) {
  if (!sub || sub.status === 'ended') return undefined;
  const o = OFFERS[sub.kind];
  return { kind: sub.kind, status: sub.status, chargeAt: sub.chargeAt, cancelled: sub.cancelled, firstPaise: sub.intro && sub.paidCount === 0 ? o.introPaise : o.paise, paise: o.paise, period: o.period };
}

/** GET /v1/plus: the offer as it applies to this account, and its subscription. */
export async function getPlus(identity: Identity): Promise<Res> {
  const now = Date.now();
  const available = !!identity.email && (await razorpayConfigured());
  const startsAt = lockInStart(identity, now);
  const intro = !!startsAt && !!(await introOfferId());
  const plan = identity.plan;
  return json(200, {
    available,
    testMode: available ? await testMode() : false,
    signedIn: !!identity.email,
    plan: plan && planActive(plan, now) ? { id: plan.id, name: PLANS[plan.id]?.name, status: plan.status, periodEnd: plan.periodEnd, cancelled: plan.cancelled, provider: plan.provider } : undefined,
    subscription: subForClient(await getSub(identity.id)),
    offer: {
      bytes: PLANS.plus50.bytes,
      // Lock-in: nothing charged today, the first charge when the welcome ends.
      startsAt,
      monthly: { kind: 'plus50-month', paise: OFFERS['plus50-month'].paise, firstPaise: intro ? OFFERS['plus50-month'].introPaise : OFFERS['plus50-month'].paise },
      yearly: { kind: 'plus50-year', paise: OFFERS['plus50-year'].paise, firstPaise: OFFERS['plus50-year'].paise },
    },
  });
}

/**
 * POST /v1/plus/checkout {kind}: a Razorpay subscription and its hosted page (UPI Autopay, cards).
 * The app opens `url` in the browser, then calls POST /v1/plus/refresh when the person comes back.
 */
export async function checkout(identity: Identity, req: Req): Promise<Res> {
  if (!identity.email) throw new HttpError(403, 'Sign in to get Lens Plus', 'sign-in');
  const kind = req.body.kind as OfferKind;
  if (!OFFERS[kind]) throw new HttpError(400, 'Unknown plan');
  const now = Date.now();
  const current = await getSub(identity.id);
  if (current && (current.status === 'scheduled' || current.status === 'active') && !current.cancelled) {
    throw new HttpError(409, 'You already have Lens Plus', 'already');
  }
  if (planActive(identity.plan, now) && !identity.plan!.cancelled) throw new HttpError(409, 'You already have Lens Plus', 'already');

  // An unfinished checkout for the same choice (made in the last day) is reused.
  if (current?.status === 'created' && current.kind === kind && now - current.createdAt < DAY) {
    const s = await rzp<RzpSubscription>('GET', `/subscriptions/${current.id}`);
    if (s.status === 'created' && s.short_url) return json(200, { url: s.short_url, id: s.id });
  }

  const planId = (await planIds())[kind];
  if (!planId) throw new HttpError(503, 'Payments aren’t available yet', 'payments-off');
  const startsAt = lockInStart(identity, now);
  // A plan that's cancelled but still paid for: the new one starts when it ends.
  const paidUntil = planActive(identity.plan, now) ? identity.plan!.periodEnd : undefined;
  const startAt = Math.max(startsAt ?? 0, paidUntil ?? 0) || undefined;
  const offerId = startsAt && kind === 'plus50-month' ? await introOfferId() : undefined;
  const s = await rzp<RzpSubscription>('POST', '/subscriptions', {
    plan_id: planId,
    // Renews until cancelled (Razorpay needs a count): 10 years of months, or 10 years.
    total_count: OFFERS[kind].period === 'month' ? 120 : 10,
    customer_notify: 1,
    ...(startAt ? { start_at: Math.floor(startAt / 1000) } : {}),
    ...(offerId ? { offer_id: offerId } : {}),
    ...(identity.email.endsWith('@e2e.lens.invalid') ? {} : { notify_info: { notify_email: identity.email } }),
    notes: { app: 'lens', account: identity.id, kind },
  });
  if (!s.short_url) throw new HttpError(502, 'The payment service didn’t answer. Try again in a minute.', 'payments-error');
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `RZP#${s.id}`, sk: 'SUB', accountId: identity.id, createdAt: now } }));
  await saveSub(identity.id, { id: s.id, kind, status: 'created', chargeAt: startAt, intro: !!offerId, paidCount: 0, createdAt: now, updatedAt: now });
  await audit({ entity: `plan:${identity.id}`, action: 'plus.checkout', actor: identity.id, data: { kind, subscription: s.id, startAt, intro: !!offerId } });
  return json(200, { url: s.short_url, id: s.id });
}

/** Paid invoices → affiliate commissions (idempotent per payment id). */
async function recordInvoices(accountId: string, subId: string, kind: OfferKind) {
  const r = await rzp<{ items: RzpInvoice[] }>('GET', `/invoices?subscription_id=${subId}&count=20`);
  for (const inv of r.items ?? []) {
    if (inv.status !== 'paid' || !inv.payment_id) continue;
    const gross = inv.amount_paid ?? inv.amount ?? 0;
    // India prices include 18% GST; Razorpay's fee is ~2% (exact fee only on the settlement report).
    await recordPurchase({ orderId: `rzp:${inv.payment_id}`, userId: accountId, grossPaise: gross, taxPaise: Math.round((gross * 18) / 118), feePaise: Math.round(gross * 0.02), at: (inv.paid_at ?? 0) * 1000 || undefined, product: kind }).catch((e) => console.error('commission', e));
  }
}

/** Reads the subscription from Razorpay and moves this account's plan to match. */
export async function reconcile(accountId: string, actor = 'razorpay'): Promise<SubState | undefined> {
  const sub = await getSub(accountId);
  if (!sub || sub.status === 'ended') return sub;
  const s = await rzp<RzpSubscription>('GET', `/subscriptions/${sub.id}`);
  const now = Date.now();
  const offer = OFFERS[sub.kind];
  const next: SubState = { ...sub, paidCount: s.paid_count ?? 0, chargeAt: s.charge_at ? s.charge_at * 1000 : sub.chargeAt, updatedAt: now };
  const plan = await getPlan(accountId);

  switch (s.status) {
    case 'created':
      // Never finished: forget it after 2 days (the person can start again any time), and close it
      // at Razorpay so an old payment page can't start a subscription we no longer track.
      if (now - sub.createdAt > 2 * DAY) {
        await rzp('POST', `/subscriptions/${sub.id}/cancel`, { cancel_at_cycle_end: 0 }).catch(() => {});
        next.status = 'ended';
      }
      break;
    case 'authenticated':
      next.status = 'scheduled'; // mandate set up, first charge at chargeAt
      break;
    case 'active': {
      next.status = 'active';
      const periodEnd = (s.current_end ?? 0) * 1000;
      if (periodEnd && (!plan || plan.status !== 'active' || plan.periodEnd !== periodEnd || plan.ref !== sub.id)) {
        await activatePlan(accountId, { id: offer.plan, periodEnd, provider: 'razorpay', ref: sub.id }, actor);
        await recordInvoices(accountId, sub.id, sub.kind);
      }
      break;
    }
    case 'pending':
    case 'halted':
    case 'paused':
      // A renewal failed: 7 days of grace (Razorpay retries meanwhile; paying restores at once).
      if (plan?.ref === sub.id && plan.status === 'active') await paymentFailed(accountId, actor);
      break;
    case 'cancelled':
    case 'completed':
    case 'expired':
      next.status = 'ended';
      // Paid time runs to its end; nothing was charged yet → nothing to do.
      if (plan?.ref === sub.id && plan.status !== 'lapsed' && !plan.cancelled) await cancelPlan(accountId, actor);
      break;
  }
  if (JSON.stringify(next) !== JSON.stringify({ ...sub, updatedAt: now })) {
    await saveSub(accountId, next);
    if (next.status !== sub.status) await audit({ entity: `plan:${accountId}`, action: `plus.${next.status}`, actor, data: { subscription: sub.id, razorpay: s.status, chargeAt: next.chargeAt } });
  }
  return next;
}

/** POST /v1/plus/refresh: the person came back from the payment page. */
export async function refreshPlus(identity: Identity): Promise<Res> {
  await reconcile(identity.id, identity.id);
  return getPlus({ ...identity, plan: await getPlan(identity.id) });
}

/**
 * POST /v1/plus/cancel: one tap. Before the first charge the mandate is cancelled at once (nothing
 * was ever paid); a running plan keeps working until the end of what was paid for.
 */
export async function cancelPlus(identity: Identity): Promise<Res> {
  const sub = await getSub(identity.id);
  if (sub && sub.status !== 'ended' && !sub.cancelled) {
    const started = sub.status === 'active';
    await rzp('POST', `/subscriptions/${sub.id}/cancel`, { cancel_at_cycle_end: started ? 1 : 0 });
    await saveSub(identity.id, started ? { ...sub, cancelled: true, updatedAt: Date.now() } : { ...sub, status: 'ended', updatedAt: Date.now() });
    if (started) await cancelPlan(identity.id, identity.id);
    await audit({ entity: `plan:${identity.id}`, action: 'plus.cancelled', actor: identity.id, data: { subscription: sub.id, started } });
  } else if (identity.plan && planActive(identity.plan) && identity.plan.provider === 'manual') {
    throw new HttpError(400, 'This plan was given by Lens support and ends by itself.');
  }
  return getPlus({ ...identity, plan: await getPlan(identity.id) });
}

/** POST /v1/razorpay/webhook (public; signed with the dashboard webhook secret). */
export async function webhook(req: Req): Promise<Res> {
  if (!(await verifyWebhook(req.rawBody, req.headers['x-razorpay-signature']))) throw new HttpError(401, 'Bad signature');
  const subId = req.body?.payload?.subscription?.entity?.id as string | undefined;
  const linkId = req.body?.payload?.payment_link?.entity?.id as string | undefined;
  if (subId) {
    const row = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `RZP#${subId}`, sk: 'SUB' } }))).Item;
    if (row?.accountId) await reconcile(row.accountId as string, 'razorpay-webhook');
  }
  if (linkId) {
    await settleLink(linkId);
  }
  return json(200, { ok: true });
}

/**
 * Every 15 minutes (Maintenance): subscriptions with something due — a checkout in progress, a first
 * charge or a renewal within a day, or grace. Webhooks usually get there first; this is the backstop.
 */
export async function reconcileDue(rows: { id: string; sub?: SubState; plan?: { status: string; periodEnd: number; ref?: string } }[], now = Date.now()) {
  if (!(await razorpayConfigured())) return 0;
  let n = 0;
  for (const r of rows) {
    const s = r.sub;
    if (!s || s.status === 'ended') continue;
    const due =
      // Checkouts: often in the first 2 hours, then once more when they're 2 days old.
      (s.status === 'created' && (now - s.createdAt < 2 * 3_600_000 || now - s.createdAt > 2 * DAY)) ||
      (s.status === 'scheduled' && (s.chargeAt ?? 0) - now < DAY) ||
      (s.status === 'active' && r.plan?.ref === s.id && (r.plan.status !== 'active' || r.plan.periodEnd - now < DAY));
    if (!due) continue;
    await reconcile(r.id, 'system').catch((e) => console.error('reconcile', r.id, e));
    n++;
  }
  return n;
}
