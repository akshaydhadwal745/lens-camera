// Extra storage above Lens Plus, paid per GB used (owner decision 2026-10-26; docs/features/extra-storage.md).
//
//   ₹3 per GB per month for what's kept above the plan (50 GB), measured once a day:
//   each day adds (GB above the plan) to `gbDays`; the bill is gbDays × ₹3 / 30 (10 paise a GB-day).
//
//   The person opts in and picks a monthly cap: a quick pick (10 / 20 / 50 / 100 GB) or any whole
//   number of GB (owner 2026-10-29: "choice + amount"). The cap is also the storage
//   limit: backups above plan + cap pause (lib.ts checkQuota 'extra-cap'), so the bill can never be
//   more than cap × ₹3. Alerts at 50, 80 and 100 % of the cap (push; email at 100 %).
//
//   Billing: 3 days before the Lens Plus renewal, the amount is added to that payment as a Razorpay
//   subscription add-on (one Razorpay pre-debit notice covers the total), and we tell them the exact
//   total first (push + email). Below ₹1 it carries over to the next month. If they cancel Lens Plus,
//   the last month's extra storage isn't charged.
//
//   Website + website APK (Razorpay, monthly Plus). Play app: the person picks a size and Google bills
//   GB × ₹3 a month as a subscription (play-billing.ts; extra.provider = 'play': no metering here).
//   Yearly Plus on Razorpay: not yet (no monthly charge to add to).
//
// Never: charging without the opt-in, charging above the cap, or blocking/deleting photos because of
// a bill. A failed payment is the normal Lens Plus grace (plans.ts): extra storage keeps working.
//
// State: PROFILE.extra = ExtraState; bills D#<id> / XB#<subscription>#<periodEnd> (kept 8 years).
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { audit } from './audit';
import type { Identity } from './identity';
import { ddb, env, HttpError, json, quotaFor, Req, Res } from './lib';
import type { SubState } from './payments';
import { planActive, type PlanState } from './plans';
import { razorpayConfigured, rzp, testMode } from './razorpay';

const DAY = 86_400_000;
const GB = 1024 ** 3;
/** ₹3 per GB-month, GST included. */
export const PAISE_PER_GB_MONTH = 300;
/** Quick picks; any whole number from 1 to MAX_CAP_GB works too. */
export const CAP_OPTIONS = [10, 20, 50, 100] as const;
export const MAX_CAP_GB = 1000;
/** Bills are added this long before the renewal (Razorpay's pre-debit notice goes out ~24 h before). */
export const BILL_BEFORE_MS = 3 * DAY;
const MIN_BILL_PAISE = 100;

export type ExtraState = {
  /** 0 = off. */
  capGB: number;
  /** The current metering period started (first opt-in, or the last bill). */
  meterFrom: number;
  /** GB above the plan, summed once a day since meterFrom. */
  gbDays: number;
  /** IST date of the last daily reading (YYYY-MM-DD). */
  lastDay?: string;
  /** Highest cap during this period: the most this period can cost. */
  periodCapGB: number;
  /** Renewal (plan.periodEnd) the last bill was made for. */
  billedFor?: number;
  agreedAt?: number;
  /** Bought in the Play app: Google bills it (no metering, no add-ons); `ref` = its purchase. */
  provider?: 'play';
  ref?: string;
  updatedAt: number;
};

export type ExtraBill = {
  from: number;
  to: number;
  gbDays: number;
  paise: number;
  capGB: number;
  /** When it's charged together with Lens Plus. */
  chargeAt: number;
  subId: string;
  addonId?: string;
  createdAt: number;
};

type Profile = { email?: string; usedBytes?: number; bonusBytes?: number; welcomeUntil?: number; plan?: PlanState; sub?: SubState; extra?: ExtraState };

const profileKey = (id: string) => ({ pk: `D#${id}`, sk: 'PROFILE' });
const istDay = (t: number) => new Date(t + 330 * 60_000).toISOString().slice(0, 10);
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: paise % 100 ? 2 : 0 })}`;
const gbText = (b: number) => `${(b / GB).toFixed(b >= 10 * GB ? 0 : 1)} GB`;
const dateText = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

/** Storage without the extra (plan + invites): what's above it is "extra". */
export const baseQuota = (p: Profile, now = Date.now()) => quotaFor({ ...p, extra: undefined }, now);
export const extraUsedBytes = (p: Profile, now = Date.now()) => Math.max(0, (p.usedBytes ?? 0) - baseQuota(p, now));
/** gbDays → paise (10 paise per GB-day), never above the period's cap. */
export const billPaise = (gbDays: number, capGB: number) => Math.min(Math.round((gbDays * PAISE_PER_GB_MONTH) / 30), capGB * PAISE_PER_GB_MONTH);

/** Who can turn it on: Lens Plus monthly through Razorpay, running and not cancelled. */
export function eligibility(p: Profile, now = Date.now()): { ok: boolean; reason?: 'sign-in' | 'needs-plus' | 'yearly' | 'cancelled' | 'grace' | 'other-provider'; message?: string } {
  if (!p.email) return { ok: false, reason: 'sign-in', message: 'Sign in and get Lens Plus first.' };
  const plan = p.plan;
  if (!plan || !planActive(plan, now)) return { ok: false, reason: 'needs-plus', message: 'Extra storage comes with Lens Plus (50 GB). Get Lens Plus first.' };
  if (plan.provider !== 'razorpay') return { ok: false, reason: 'other-provider', message: 'Extra storage needs Lens Plus paid on the Lens website or app from our website.' };
  if (plan.cancelled || p.sub?.cancelled) return { ok: false, reason: 'cancelled', message: 'Your Lens Plus is cancelled, so extra storage can’t be added.' };
  if (p.sub?.kind !== 'plus50-month' || p.sub.status !== 'active') return { ok: false, reason: 'yearly', message: 'Extra storage is added to your monthly Lens Plus payment, so it needs the monthly plan.' };
  if (plan.status === 'grace') return { ok: false, reason: 'grace', message: 'Your last Lens Plus payment didn’t go through. Fix it first, then you can add more.' };
  return { ok: true };
}

async function bills(id: string, limit = 12): Promise<ExtraBill[]> {
  const r = await ddb.send(
    new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :b)', ExpressionAttributeValues: { ':p': `D#${id}`, ':b': 'XB#' } }),
  );
  return ((r.Items ?? []) as ExtraBill[]).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function view(p: Profile, history: ExtraBill[], now: number) {
  const e = p.extra;
  const used = extraUsedBytes(p, now);
  const cap = e?.capGB ?? 0;
  const periodEnd = p.plan && planActive(p.plan, now) ? p.plan.periodEnd : undefined;
  const soFar = e ? billPaise(e.gbDays, Math.max(e.periodCapGB, cap)) : 0;
  // Until the next bill, if they keep what they have now.
  const daysLeft = periodEnd ? Math.max(0, Math.ceil((periodEnd - BILL_BEFORE_MS - now) / DAY)) : 0;
  const estimate = e ? billPaise(e.gbDays + (used / GB) * daysLeft, Math.max(e.periodCapGB, cap)) : 0;
  return {
    paisePerGB: PAISE_PER_GB_MONTH,
    options: CAP_OPTIONS,
    maxCapGB: MAX_CAP_GB,
    provider: e?.provider,
    capGB: cap,
    maxPaise: cap * PAISE_PER_GB_MONTH,
    baseBytes: baseQuota(p, now),
    usedBytes: p.usedBytes ?? 0,
    extraBytes: used,
    period: e && cap ? { from: e.meterFrom, billAt: periodEnd ? periodEnd - BILL_BEFORE_MS : undefined, chargeAt: periodEnd } : undefined,
    soFarPaise: soFar,
    estimatePaise: estimate,
    bills: history.map((b) => ({
      from: b.from,
      to: b.to,
      gbMonths: Math.round((b.gbDays / 30) * 10) / 10,
      paise: b.paise,
      chargeAt: b.chargeAt,
      status: now < b.chargeAt ? 'upcoming' : p.plan && p.plan.periodEnd > b.chargeAt ? 'charged' : 'not-charged',
    })),
  };
}

/** GET /v1/extra */
export async function getExtra(identity: Identity): Promise<Res> {
  const now = Date.now();
  const configured = await razorpayConfigured();
  return json(200, {
    available: configured,
    testMode: configured ? await testMode() : false,
    ...eligibility(identity, now),
    ...view(identity, await bills(identity.id), now),
  });
}

/**
 * POST /v1/extra {capGB, agree}: turn on, raise, lower or turn off. Raising needs `agree: true` (the
 * app shows the price and the most it can cost first). Lowering can't go below what's already kept
 * above the plan (they'd be over their limit straight away): free up space first.
 */
export async function setExtra(identity: Identity, req: Req): Promise<Res> {
  const now = Date.now();
  const capGB = Number(req.body?.capGB);
  if (!Number.isInteger(capGB) || capGB < 0 || capGB > MAX_CAP_GB) throw new HttpError(400, `Choose a whole number of GB from 1 to ${MAX_CAP_GB}`);
  const before = identity.extra;
  if (before?.provider === 'play' && before.capGB) throw new HttpError(409, 'Your extra storage is managed in Google Play: change it in the Lens app from Google Play.', 'play-managed');
  const current = before?.capGB ?? 0;
  if (capGB === current) return getExtra(identity);
  const usedGB = extraUsedBytes(identity, now) / GB;
  if (capGB > current) {
    const elig = eligibility(identity, now);
    if (!elig.ok) throw new HttpError(409, elig.message!, elig.reason);
    if (!(await razorpayConfigured())) throw new HttpError(503, 'Payments aren’t available yet', 'payments-off');
    if (req.body?.agree !== true) throw new HttpError(400, 'Please confirm the price first', 'agree');
  } else if (capGB < usedGB) {
    throw new HttpError(
      409,
      `You keep ${usedGB.toFixed(1)} GB above your plan. Free up space first (move photos to your Google Drive, download or delete them), then ${capGB ? 'lower the limit' : 'turn it off'}.`,
      'extra-in-use',
    );
  }
  const fresh = !before || (before.capGB === 0 && before.gbDays === 0);
  const next: ExtraState = {
    capGB,
    meterFrom: fresh ? now : before.meterFrom,
    gbDays: fresh ? 0 : before.gbDays,
    lastDay: fresh ? undefined : before.lastDay,
    periodCapGB: Math.max(capGB, fresh ? 0 : before.periodCapGB),
    billedFor: before?.billedFor,
    agreedAt: capGB > current ? now : before?.agreedAt,
    updatedAt: now,
  };
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: profileKey(identity.id),
      UpdateExpression: 'SET #e = :e',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#e': 'extra' },
      ExpressionAttributeValues: { ':e': next },
    }),
  );
  await audit({ entity: `plan:${identity.id}`, action: capGB > current ? 'extra.raised' : capGB ? 'extra.lowered' : 'extra.off', actor: identity.id, data: { from: current, to: capGB, agreed: capGB > current } });
  return getExtra({ ...identity, extra: next });
}

type Notice = (name: string, markName: string, title: string, body: string, withEmail: boolean) => Promise<boolean>;

/**
 * Once a day per account (lifecycle.ts, 10:00 on their phone): read the GB above the plan, send the
 * 50/80/100 % alerts, and add the bill to the next Lens Plus payment when it's 3 days away.
 */
export async function dailyExtra(id: string, p: Profile, now: number, notice: Notice): Promise<'billed' | 'alert' | undefined> {
  const e = p.extra;
  if (!e || (!e.capGB && !e.gbDays)) return undefined;
  // Bought on Play: Google bills it and play-billing.ts follows its state; nothing to meter.
  if (e.provider === 'play') return undefined;
  const plan = p.plan;
  const paid = !!plan && planActive(plan, now);
  const today = istDay(now);
  let state = e;

  // Lens Plus ended: extra storage switches off (turning it on again asks again). What wasn't
  // billed yet isn't charged.
  if (!paid) {
    if (e.capGB || e.gbDays) {
      await saveExtra(id, { ...e, capGB: 0, gbDays: 0, periodCapGB: 0, updatedAt: now });
      await audit({ entity: `plan:${id}`, action: 'extra.off', actor: 'system', data: { reason: 'plan-ended', waivedGbDays: e.gbDays } });
    }
    return undefined;
  }

  // 1. The daily reading (only while the plan gives its storage; once per IST day).
  if (e.lastDay !== today) {
    const used = extraUsedBytes(p, now);
    const add = Math.min(used, e.capGB * GB) / GB;
    state = { ...e, gbDays: Math.round((e.gbDays + add) * 1000) / 1000, lastDay: today, updatedAt: now };
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.table,
          Key: profileKey(id),
          UpdateExpression: 'SET #e = :e',
          ConditionExpression: 'attribute_exists(pk) AND (attribute_not_exists(#e.lastDay) OR #e.lastDay <> :d)',
          ExpressionAttributeNames: { '#e': 'extra' },
          ExpressionAttributeValues: { ':e': state, ':d': today },
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
      return undefined; // another run already read today
    }

    // Alerts: share of the cap in use, once per threshold per period.
    if (e.capGB) {
      const pct = used / (e.capGB * GB);
      const step = pct >= 1 ? 100 : pct >= 0.8 ? 80 : pct >= 0.5 ? 50 : 0;
      if (step) {
        const title = step === 100 ? 'Your extra storage limit is reached' : `You're using ${step}% of your extra storage limit`;
        const body =
          step === 100
            ? `You keep ${gbText(used)} above Lens Plus, your limit of ${e.capGB} GB. New photos wait on your phone; everything you have is safe. Raise the limit (₹3 per GB a month) or free up space in Settings → Lens Plus.`
            : `${gbText(used)} of the ${e.capGB} GB you allowed above Lens Plus. At most ${rupees(e.capGB * PAISE_PER_GB_MONTH)} a month; you only pay for what you keep.`;
        if (await notice('extra_alert', `extra${step}-${e.meterFrom}`, title, body, step === 100)) return 'alert';
      }
    }
  }

  // 2. The bill, 3 days before the renewal it's added to.
  const sub = p.sub;
  if (!plan || plan.provider !== 'razorpay' || plan.status !== 'active' || plan.cancelled) return undefined;
  if (!sub || sub.status !== 'active' || sub.cancelled || sub.kind !== 'plus50-month' || plan.ref !== sub.id) return undefined;
  const chargeAt = plan.periodEnd;
  if (chargeAt - now > BILL_BEFORE_MS || chargeAt - now < 6 * 3_600_000 || state.billedFor === chargeAt) return undefined;
  const capGB = Math.max(state.periodCapGB, state.capGB);
  const paise = billPaise(state.gbDays, capGB);
  if (paise < MIN_BILL_PAISE) {
    // Too small to charge: carries over to next month.
    await saveExtra(id, { ...state, billedFor: chargeAt, updatedAt: now });
    return undefined;
  }
  const bill: ExtraBill = { from: state.meterFrom, to: now, gbDays: state.gbDays, paise, capGB, chargeAt, subId: sub.id, createdAt: now };
  const billKey = { pk: `D#${id}`, sk: `XB#${sub.id}#${chargeAt}` };
  // Claim first so two runs can never add two add-ons for the same renewal.
  try {
    await ddb.send(new PutCommand({ TableName: env.table, Item: { ...billKey, ...bill, ttl: Math.floor(now / 1000) + 8 * 366 * 86400 }, ConditionExpression: 'attribute_not_exists(pk)' }));
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return undefined;
    throw err;
  }
  let addonId: string;
  try {
    const a = await rzp<{ id: string }>('POST', `/subscriptions/${sub.id}/addons`, {
      item: { name: 'Lens extra storage', amount: paise, currency: 'INR', description: `${(state.gbDays / 30).toFixed(1)} GB-months above Lens Plus, ${istDay(state.meterFrom)} to ${today}` },
      quantity: 1,
    });
    addonId = a.id;
  } catch (err) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: billKey })); // try again tomorrow
    throw err;
  }
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: billKey, UpdateExpression: 'SET addonId = :a', ExpressionAttributeValues: { ':a': addonId } }));
  await saveExtra(id, { ...state, meterFrom: now, gbDays: 0, periodCapGB: state.capGB, billedFor: chargeAt, updatedAt: now });
  await audit({ entity: `plan:${id}`, action: 'extra.billed', actor: 'system', data: { paise, gbDays: state.gbDays, capGB, chargeAt, subscription: sub.id, addon: addonId } });
  const plusPaise = 5_900;
  await notice(
    'extra_bill',
    `extra-bill-${chargeAt}`,
    `Extra storage: ${rupees(paise)} with your next Lens Plus payment`,
    `On ${dateText(chargeAt)}: Lens Plus ${rupees(plusPaise)} + extra storage ${rupees(paise)} = ${rupees(plusPaise + paise)}. That's ${(state.gbDays / 30).toFixed(1)} GB-months above 50 GB since ${dateText(state.meterFrom)}, at ₹3 per GB a month (your limit: ${capGB} GB, at most ${rupees(capGB * PAISE_PER_GB_MONTH)}). Details in Settings → Lens Plus.`,
    true,
  );
  return 'billed';
}

async function saveExtra(id: string, e: ExtraState) {
  await ddb.send(
    new UpdateCommand({ TableName: env.table, Key: profileKey(id), UpdateExpression: 'SET #e = :e', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeNames: { '#e': 'extra' }, ExpressionAttributeValues: { ':e': e } }),
  );
}

/** Lens Console: an account's extra storage and bills. */
export async function extraForConsole(id: string) {
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: profileKey(id) }))).Item as Profile | undefined;
  if (!p) return undefined;
  return { ...view(p, await bills(id, 24), Date.now()), extra: p.extra };
}
