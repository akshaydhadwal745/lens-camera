// Affiliate program: approved partners earn 50% of the NET revenue (after GST
// and Google Play's fee) from users they bring, for as long as those users pay
// (lifetime recurring; user decisions 2026-10-09). Separate from user referrals.
//
// Lifecycle of money (all amounts in integer paise):
//   purchase → commission "pending" (30-day hold for refunds)
//            → "approved" (daily maintenance)  → in a monthly payout → "paid"
//   refund during the hold → "reversed"; after approval → a negative
//   adjustment deducted from the next payout.
// Payouts: monthly, manual UPI/bank transfer (exported list), minimum ₹1,000,
// TDS (Income-tax s.194H) 2% once a financial year's commission passes ₹20,000,
// 20% without PAN. Confirm the rates with the CA before the first payout.
//
// PAYMENTS ARE NOT BUILT YET: recordPurchase/recordRefund are called from the
// Maintenance function only (tests); Play Billing + RTDN will call them later.
//
// Keys:  D#<aff>  AFFILIATE            status, KYC (encrypted), counters; gsi1 AFFILIATES / <status>#<time>
//        D#<aff>  AL#<code>            a tracking link (campaign)
//        D#<aff>  CM#<orderId>         commission; gsi1 CM_HOLD / <holdUntil>#… while pending
//        D#<aff>  PO#<yyyy-mm>         payout statement
//        ORD#<orderId> COMMISSION      → affiliate (refund lookups)
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { Attribution, bumpStats, createCode } from './attribution';
import { audit } from './audit';
import type { Identity } from './identity';
import { notify } from './referrals';
import { ddb, derivedKey, env, HttpError, json, Req, Res } from './lib';

export const affiliateSettings = {
  rateBps: Number(process.env.AFFILIATE_RATE_BPS ?? 5000),
  holdMs: 30 * 86400_000,
  minPayoutPaise: 1000_00,
  tdsThresholdPaise: 20_000_00,
  tdsBps: 200,
  tdsNoPanBps: 2000,
  maxLinks: 20,
  termsVersion: '2026-10-09',
};

const affKey = (id: string) => ({ pk: `D#${id}`, sk: 'AFFILIATE' });
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UPI = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

// ---------- KYC encryption (AES-256-GCM, key derived from our private signing key) ----------

async function seal(value: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await derivedKey('kyc'), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

async function open(sealed: string | undefined): Promise<string | undefined> {
  if (!sealed) return undefined;
  const [iv, tag, data] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', await derivedKey('kyc'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const mask = (v: string, keep = 4) => `${'•'.repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}`;

function text(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

async function getAffiliate(id: string) {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: affKey(id) }))).Item;
}

// ---------- Partner side ----------

/** POST /v1/affiliates/apply {name, channels, audience, pan?, upi?, agree}: signed-in accounts. */
export async function apply(identity: Identity, req: Req): Promise<Res> {
  if (!identity.email) throw new HttpError(403, 'Sign in first', 'sign-in');
  if (req.body?.agree !== true) throw new HttpError(400, 'Please accept the affiliate terms');
  const name = text(req.body.name, 100);
  const channels = text(req.body.channels, 500);
  if (!name || !channels) throw new HttpError(400, 'Enter your name and where you will share Lens');
  const pan = text(req.body.pan, 10).toUpperCase();
  const upi = text(req.body.upi, 300);
  if (pan && !PAN.test(pan)) throw new HttpError(400, 'That PAN doesn’t look right');
  if (upi && !UPI.test(upi)) throw new HttpError(400, 'That UPI ID doesn’t look right');
  const existing = await getAffiliate(identity.id);
  if (existing && existing.status !== 'rejected') throw new HttpError(409, 'You already applied');
  const now = Date.now();
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: {
        ...affKey(identity.id),
        status: 'applied',
        name,
        email: identity.email,
        channels,
        audience: text(req.body.audience, 500),
        ...(pan ? { pan: await seal(pan), panMasked: mask(pan) } : {}),
        ...(upi ? { upi: await seal(upi), upiMasked: mask(upi, 8) } : {}),
        termsVersion: affiliateSettings.termsVersion,
        appliedAt: now,
        gsi1pk: 'AFFILIATES',
        gsi1sk: `applied#${now}`,
      },
    }),
  );
  await audit({ entity: `affiliate:${identity.id}`, action: 'affiliate.applied', actor: identity.id, data: { name, channels } });
  return json(201, { status: 'applied' });
}

/** PUT /v1/affiliates/payout-details {pan?, upi?}: KYC / payout method (stored encrypted). */
export async function updatePayoutDetails(identity: Identity, req: Req): Promise<Res> {
  const aff = await getAffiliate(identity.id);
  if (!aff) throw new HttpError(404, 'Apply first');
  const pan = text(req.body?.pan, 10).toUpperCase();
  const upi = text(req.body?.upi, 300);
  if (pan && !PAN.test(pan)) throw new HttpError(400, 'That PAN doesn’t look right');
  if (upi && !UPI.test(upi)) throw new HttpError(400, 'That UPI ID doesn’t look right');
  if (!pan && !upi) throw new HttpError(400, 'Nothing to update');
  const sets: string[] = [];
  const values: Record<string, unknown> = {};
  if (pan) Object.assign(values, { ':p': await seal(pan), ':pm': mask(pan) }), sets.push('pan = :p', 'panMasked = :pm');
  if (upi) Object.assign(values, { ':u': await seal(upi), ':um': mask(upi, 8) }), sets.push('upi = :u', 'upiMasked = :um');
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: affKey(identity.id), UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeValues: values }));
  await audit({ entity: `affiliate:${identity.id}`, action: 'affiliate.payout-details', actor: identity.id, data: { pan: !!pan, upi: !!upi } });
  return json(200, { panMasked: values[':pm'] ?? aff.panMasked, upiMasked: values[':um'] ?? aff.upiMasked });
}

/** POST /v1/affiliates/links {campaign}: a new tracking link (approved partners). */
export async function createLink(identity: Identity, req: Req): Promise<Res> {
  const aff = await getAffiliate(identity.id);
  if (aff?.status !== 'approved') throw new HttpError(403, 'Your affiliate account isn’t approved yet');
  const campaign = text(req.body?.campaign, 60) || 'default';
  const links = await query(`D#${identity.id}`, 'AL#');
  if (links.length >= affiliateSettings.maxLinks) throw new HttpError(409, `Up to ${affiliateSettings.maxLinks} links`);
  const record = await createCode(identity.id, 'affiliate', campaign);
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `D#${identity.id}`, sk: `AL#${record.code}`, code: record.code, campaign, createdAt: record.createdAt } }));
  await audit({ entity: `affiliate:${identity.id}`, action: 'affiliate.link-created', actor: identity.id, data: { code: record.code, campaign } });
  return json(201, { code: record.code, campaign, url: `${env.webOrigin}/go/${record.code}` });
}

async function query(pk: string, prefix: string, extra: Record<string, unknown> = {}): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let start: Record<string, any> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
        ExpressionAttributeValues: { ':p': pk, ':s': prefix },
        ExclusiveStartKey: start,
        ...extra,
      }),
    );
    items.push(...(page.Items ?? []));
    start = page.LastEvaluatedKey;
  } while (start);
  return items;
}

/** Sums the daily counters of one link over the last `days` days. */
async function linkStats(code: string, days = 365) {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10).replace(/-/g, '');
  const rows = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND sk >= :s',
      ExpressionAttributeValues: { ':p': `AS#${code}`, ':s': since },
    }),
  );
  const total = { clicks: 0, signups: 0, payers: 0, netPaise: 0, commissionPaise: 0 };
  const daily: { day: string; clicks: number; signups: number }[] = [];
  for (const r of rows.Items ?? []) {
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += (r[k] as number) ?? 0;
    daily.push({ day: r.sk as string, clicks: r.clicks ?? 0, signups: r.signups ?? 0 });
  }
  return { ...total, daily: daily.slice(-90) };
}

function money(items: Record<string, any>[]) {
  const sum = (pred: (c: Record<string, any>) => boolean) => items.filter(pred).reduce((s, c) => s + (c.amountPaise as number), 0);
  return {
    pendingPaise: sum((c) => c.status === 'pending'),
    approvedPaise: sum((c) => c.status === 'approved' && !c.payoutId),
    inPayoutPaise: sum((c) => c.status === 'approved' && !!c.payoutId && !c.paid),
    paidPaise: sum((c) => !!c.paid),
  };
}

/** GET /v1/affiliates/me: the partner dashboard. */
export async function dashboard(identity: Identity): Promise<Res> {
  const aff = await getAffiliate(identity.id);
  if (!aff) return json(200, { status: 'none', termsVersion: affiliateSettings.termsVersion, rateBps: affiliateSettings.rateBps });
  const [links, commissions, payouts] = await Promise.all([
    query(`D#${identity.id}`, 'AL#'),
    query(`D#${identity.id}`, 'CM#'),
    query(`D#${identity.id}`, 'PO#'),
  ]);
  const linkRows = await Promise.all(
    links.map(async (l) => ({ code: l.code, campaign: l.campaign, url: `${env.webOrigin}/go/${l.code}`, createdAt: l.createdAt, ...(await linkStats(l.code)) })),
  );
  return json(200, {
    status: aff.status,
    name: aff.name,
    rateBps: affiliateSettings.rateBps,
    holdDays: affiliateSettings.holdMs / 86400_000,
    minPayoutPaise: affiliateSettings.minPayoutPaise,
    panMasked: aff.panMasked,
    upiMasked: aff.upiMasked,
    note: aff.status === 'rejected' || aff.status === 'suspended' ? aff.note : undefined,
    links: linkRows,
    ...money(commissions),
    commissions: commissions
      .sort((a, b) => b.at - a.at)
      .slice(0, 100)
      .map((c) => ({ id: (c.sk as string).slice(3), at: c.at, netPaise: c.netPaise, amountPaise: c.amountPaise, status: c.status, paid: !!c.paid, holdUntil: c.holdUntil })),
    payouts: payouts
      .sort((a, b) => (a.sk < b.sk ? 1 : -1))
      .map((p) => ({ month: (p.sk as string).slice(3), grossPaise: p.grossPaise, tdsPaise: p.tdsPaise, netPaise: p.netPaise, status: p.status, reference: p.reference, paidAt: p.paidAt })),
  });
}

// ---------- Commission engine ----------

export type Purchase = {
  /** Google Play order id (idempotency key). */
  orderId: string;
  userId: string;
  /** What the user paid, incl. GST. */
  grossPaise: number;
  taxPaise: number;
  /** Google Play's service fee. */
  feePaise: number;
  at?: number;
  product?: string;
};

/** A verified payment by a user. Idempotent per orderId. Returns the commission status. */
export async function recordPurchase(p: Purchase): Promise<string> {
  const at = p.at ?? Date.now();
  const user = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${p.userId}`, sk: 'PROFILE' } }))).Item;
  const attribution = user?.attribution as Attribution | undefined;
  if (attribution?.program !== 'affiliate') return 'none';
  const affId = attribution.ownerId;
  const aff = await getAffiliate(affId);
  const netPaise = Math.max(0, Math.round(p.grossPaise - p.taxPaise - p.feePaise));
  const amountPaise = Math.floor((netPaise * affiliateSettings.rateBps) / 10_000);

  // Self-purchase: the buyer used one of the affiliate's own phones or emails.
  const affProfile = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${affId}`, sk: 'PROFILE' } }))).Item;
  const affFps = new Set<string>([...(affProfile?.fps ?? []), ...(affProfile?.fingerprint ? [affProfile.fingerprint] : [])]);
  const self = [...(user?.fps ?? [])].some((f: string) => affFps.has(f));
  const status = aff?.status !== 'approved' ? 'skipped' : self ? 'rejected' : 'pending';
  const reason = aff?.status !== 'approved' ? `affiliate-${aff?.status ?? 'missing'}` : self ? 'self-purchase' : undefined;
  const holdUntil = at + affiliateSettings.holdMs;
  try {
    await ddb.send(
      new PutCommand({
        TableName: env.table,
        Item: {
          pk: `D#${affId}`,
          sk: `CM#${p.orderId}`,
          orderId: p.orderId,
          userId: p.userId,
          code: attribution.code,
          product: p.product,
          at,
          grossPaise: p.grossPaise,
          taxPaise: p.taxPaise,
          feePaise: p.feePaise,
          netPaise,
          rateBps: affiliateSettings.rateBps,
          amountPaise: status === 'pending' ? amountPaise : 0,
          status,
          reason,
          holdUntil,
          ...(status === 'pending' ? { gsi1pk: 'CM_HOLD', gsi1sk: `${String(holdUntil).padStart(15, '0')}#${affId}#${p.orderId}` } : {}),
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') return 'duplicate';
    throw error;
  }
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `ORD#${p.orderId}`, sk: 'COMMISSION', affId } }));
  // First payment by this user counts as a new payer in the funnel.
  let firstPayment = false;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${p.userId}`, sk: 'PROFILE' },
        UpdateExpression: 'SET firstPaidAt = :a',
        ConditionExpression: 'attribute_not_exists(firstPaidAt)',
        ExpressionAttributeValues: { ':a': at },
      }),
    );
    firstPayment = true;
  } catch (error: any) {
    if (error?.name !== 'ConditionalCheckFailedException') throw error;
  }
  if (status === 'pending') await bumpStats(attribution.code, { netPaise, commissionPaise: amountPaise, payers: firstPayment ? 1 : 0 }, at);
  await audit({ entity: `affiliate:${affId}`, action: `commission.${status}`, actor: 'system', data: { orderId: p.orderId, userId: p.userId, netPaise, amountPaise, reason } });
  if (status === 'pending' && aff?.email) {
    await notify(aff.email, 'New commission on Lens', `A user you referred paid for Lens. Your commission: ₹${(amountPaise / 100).toFixed(2)} (approved after ${affiliateSettings.holdMs / 86400_000} days).`).catch(
      (e) => console.error('affiliate email', e),
    );
  }
  return status;
}

/** A refund/chargeback (Play voided purchase). Idempotent. */
export async function recordRefund(orderId: string, at = Date.now()): Promise<string> {
  const index = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `ORD#${orderId}`, sk: 'COMMISSION' } }))).Item;
  if (!index) return 'none';
  const affId = index.affId as string;
  const key = { pk: `D#${affId}`, sk: `CM#${orderId}` };
  const commission = (await ddb.send(new GetCommand({ TableName: env.table, Key: key }))).Item;
  if (!commission || commission.status === 'reversed' || commission.status === 'skipped' || commission.status === 'rejected') return commission?.status ?? 'none';
  // Already in a payout statement (maybe paid): keep it, claw back from the next payout.
  const clawback = commission.status === 'approved' && !!commission.payoutId;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: key,
        UpdateExpression: `SET #s = :r, reversedAt = :a${clawback ? '' : ', amountPaise = :z'} REMOVE gsi1pk, gsi1sk`,
        ConditionExpression: '#s = :old',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':r': 'reversed', ':a': at, ':old': commission.status, ...(clawback ? {} : { ':z': 0 }) },
      }),
    );
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') return 'raced';
    throw error;
  }
  if (clawback) {
    await ddb
      .send(
        new PutCommand({
          TableName: env.table,
          Item: { pk: `D#${affId}`, sk: `CM#${orderId}#refund`, orderId, at, amountPaise: -commission.amountPaise, netPaise: -commission.netPaise, status: 'approved', reason: 'refund' },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      )
      .catch((e) => {
        if (e?.name !== 'ConditionalCheckFailedException') throw e;
      });
  }
  await bumpStats(commission.code, { netPaise: -commission.netPaise, commissionPaise: -commission.amountPaise }, at);
  await audit({ entity: `affiliate:${affId}`, action: 'commission.reversed', actor: 'system', data: { orderId, amountPaise: commission.amountPaise, clawback } });
  return 'reversed';
}

/** Daily: commissions whose hold ended become approved. */
export async function approveDueCommissions(now = Date.now(), onlyAffiliate?: string): Promise<number> {
  let approved = 0;
  let start: Record<string, any> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :g AND gsi1sk <= :t',
        ExpressionAttributeValues: { ':g': 'CM_HOLD', ':t': `${String(now).padStart(15, '0')}#~` },
        ExclusiveStartKey: start,
      }),
    );
    for (const row of page.Items ?? []) {
      if (onlyAffiliate && row.pk !== `D#${onlyAffiliate}`) continue;
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: env.table,
            Key: { pk: row.pk, sk: row.sk },
            UpdateExpression: 'SET #s = :a, approvedAt = :n REMOVE gsi1pk, gsi1sk',
            ConditionExpression: '#s = :p',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':a': 'approved', ':p': 'pending', ':n': now },
          }),
        );
        approved++;
        await audit({ entity: `affiliate:${(row.pk as string).slice(2)}`, action: 'commission.approved', actor: 'system', data: { orderId: row.orderId } });
      } catch (error: any) {
        if (error?.name !== 'ConditionalCheckFailedException') throw error;
      }
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return approved;
}

// ---------- Payouts ----------

/** Indian financial year (April–March) of a time, e.g. "2026-27". */
export function financialYear(at: number): string {
  const d = new Date(at);
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** TDS on this payout given what was already credited this financial year. */
export function tdsFor(grossPaise: number, earlierThisYearPaise: number, hasPan: boolean): number {
  if (grossPaise <= 0) return 0;
  if (!hasPan) return Math.ceil((grossPaise * affiliateSettings.tdsNoPanBps) / 10_000);
  const after = earlierThisYearPaise + grossPaise;
  if (after <= affiliateSettings.tdsThresholdPaise) return 0;
  // Crossing the threshold: tax the whole year so far (earlier credits had none).
  const base = earlierThisYearPaise > affiliateSettings.tdsThresholdPaise ? grossPaise : after;
  return Math.ceil((base * affiliateSettings.tdsBps) / 10_000);
}

/**
 * POST /v1/admin/payouts/run {month: "2026-10"}: statements for every approved
 * partner with at least the minimum approved balance. Re-runnable.
 */
export async function runPayouts(adminId: string, req: Req): Promise<Res> {
  const month = text(req.body?.month, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
  const affiliates = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :g AND begins_with(gsi1sk, :s)',
      ExpressionAttributeValues: { ':g': 'AFFILIATES', ':s': 'approved#' },
    }),
  );
  // Optionally one partner only (re-run for a single person; tests).
  const only = req.body?.affiliateId ? String(req.body.affiliateId) : undefined;
  const created: Record<string, unknown>[] = [];
  for (const row of affiliates.Items ?? []) {
    const affId = (row.pk as string).slice(2);
    if (only && affId !== only) continue;
    const result = await payoutFor(affId, month, adminId);
    if (result) created.push(result);
  }
  return json(200, { month, payouts: created });
}

async function payoutFor(affId: string, month: string, adminId: string) {
  const poKey = { pk: `D#${affId}`, sk: `PO#${month}` };
  const existing = (await ddb.send(new GetCommand({ TableName: env.table, Key: poKey }))).Item;
  if (existing && existing.status !== 'preparing') return undefined;
  const commissions = await query(`D#${affId}`, 'CM#');
  const available = commissions.filter((c) => c.status === 'approved' && !c.payoutId);
  const total = available.reduce((s, c) => s + c.amountPaise, 0);
  const already = commissions.filter((c) => c.payoutId === month);
  if (!existing && total < affiliateSettings.minPayoutPaise) return undefined;
  if (!existing) {
    await ddb.send(new PutCommand({ TableName: env.table, Item: { ...poKey, status: 'preparing', createdAt: Date.now() }, ConditionExpression: 'attribute_not_exists(pk)' }));
  }
  for (const c of available) {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: c.pk, sk: c.sk },
        UpdateExpression: 'SET payoutId = :m',
        ConditionExpression: 'attribute_not_exists(payoutId) AND #s = :a',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':m': month, ':a': 'approved' },
      }),
    );
  }
  const lines = [...already, ...available];
  const grossPaise = lines.reduce((s, c) => s + c.amountPaise, 0);
  const aff = await getAffiliate(affId);
  const fy = financialYear(Date.parse(`${month}-15T00:00:00Z`));
  const earlier = (await query(`D#${affId}`, 'PO#'))
    .filter((p) => p.fy === fy && p.sk !== poKey.sk && p.status !== 'preparing')
    .reduce((s, p) => s + (p.grossPaise as number), 0);
  const tdsPaise = tdsFor(grossPaise, earlier, !!aff?.pan);
  const statement = { grossPaise, tdsPaise, netPaise: grossPaise - tdsPaise, lines: lines.length, fy };
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: poKey,
      UpdateExpression: 'SET #s = :due, grossPaise = :g, tdsPaise = :t, netPaise = :n, #l = :l, fy = :fy, gsi1pk = :gp, gsi1sk = :gs',
      ExpressionAttributeNames: { '#s': 'status', '#l': 'lines' },
      ExpressionAttributeValues: {
        ':due': 'due',
        ':g': grossPaise,
        ':t': tdsPaise,
        ':n': grossPaise - tdsPaise,
        ':l': lines.length,
        ':fy': fy,
        ':gp': `PAYOUTS#${month}`,
        ':gs': affId,
      },
    }),
  );
  await audit({ entity: `payout:${month}:${affId}`, action: 'payout.created', actor: `admin:${adminId}`, data: statement });
  return { affiliateId: affId, month, ...statement };
}

/** GET /v1/admin/payouts?month=YYYY-MM: the payout sheet (decrypted UPI/PAN for the transfer). */
export async function payoutSheet(req: Req, adminId: string): Promise<Res> {
  const month = text(req.query.month, 7);
  const rows = await ddb.send(
    new QueryCommand({ TableName: env.table, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :g', ExpressionAttributeValues: { ':g': `PAYOUTS#${month}` } }),
  );
  const payouts = [];
  for (const p of rows.Items ?? []) {
    const affId = (p.pk as string).slice(2);
    const aff = await getAffiliate(affId);
    payouts.push({
      affiliateId: affId,
      name: aff?.name,
      email: aff?.email,
      upi: await open(aff?.upi),
      pan: await open(aff?.pan),
      grossPaise: p.grossPaise,
      tdsPaise: p.tdsPaise,
      netPaise: p.netPaise,
      status: p.status,
      reference: p.reference,
    });
  }
  await audit({ entity: `payout:${month}`, action: 'payout.sheet-viewed', actor: `admin:${adminId}`, data: { count: payouts.length } });
  return json(200, { month, payouts });
}

/** POST /v1/admin/payouts/<affId>/<month>/paid {reference}: transfer done. */
export async function markPaid(adminId: string, affId: string, month: string, req: Req): Promise<Res> {
  const reference = text(req.body?.reference, 120);
  if (!reference) throw new HttpError(400, 'Enter the UPI/bank reference');
  const poKey = { pk: `D#${affId}`, sk: `PO#${month}` };
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: poKey,
        UpdateExpression: 'SET #s = :p, #ref = :r, paidAt = :n',
        ConditionExpression: '#s = :due',
        ExpressionAttributeNames: { '#s': 'status', '#ref': 'reference' },
        ExpressionAttributeValues: { ':p': 'paid', ':r': reference, ':n': Date.now(), ':due': 'due' },
      }),
    );
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') throw new HttpError(409, 'No unpaid payout for that month');
    throw error;
  }
  for (const c of (await query(`D#${affId}`, 'CM#')).filter((c) => c.payoutId === month)) {
    await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: c.pk, sk: c.sk }, UpdateExpression: 'SET paid = :t', ExpressionAttributeValues: { ':t': true } }));
  }
  const po = (await ddb.send(new GetCommand({ TableName: env.table, Key: poKey }))).Item!;
  await audit({ entity: `payout:${month}:${affId}`, action: 'payout.paid', actor: `admin:${adminId}`, data: { reference, netPaise: po.netPaise, tdsPaise: po.tdsPaise } });
  const aff = await getAffiliate(affId);
  if (aff?.email) {
    await notify(aff.email, 'Your Lens affiliate payout was sent', `We sent ₹${(po.netPaise / 100).toFixed(2)} (commission ₹${(po.grossPaise / 100).toFixed(2)}, TDS ₹${(po.tdsPaise / 100).toFixed(2)}). Reference: ${reference}.`).catch(
      (e) => console.error('payout email', e),
    );
  }
  return json(200, { status: 'paid' });
}

// ---------- Admin: partners ----------

/** GET /v1/admin/affiliates?status=applied */
export async function listAffiliates(req: Req): Promise<Res> {
  const status = text(req.query.status, 20) || 'applied';
  const rows = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :g AND begins_with(gsi1sk, :s)',
      ExpressionAttributeValues: { ':g': 'AFFILIATES', ':s': `${status}#` },
    }),
  );
  const affiliates = await Promise.all(
    (rows.Items ?? []).map(async (k) => {
      const a = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: k.pk, sk: k.sk } }))).Item ?? {};
      return { id: (k.pk as string).slice(2), status: a.status, name: a.name, email: a.email, channels: a.channels, audience: a.audience, appliedAt: a.appliedAt, panMasked: a.panMasked, upiMasked: a.upiMasked, note: a.note };
    }),
  );
  return json(200, { affiliates });
}

/** POST /v1/admin/affiliates/<id> {action: approve | reject | suspend | reinstate, note?} */
export async function decideAffiliate(adminId: string, affId: string, req: Req): Promise<Res> {
  const transitions: Record<string, { from: string[]; to: string }> = {
    approve: { from: ['applied'], to: 'approved' },
    reject: { from: ['applied'], to: 'rejected' },
    suspend: { from: ['approved'], to: 'suspended' },
    reinstate: { from: ['suspended'], to: 'approved' },
  };
  const t = transitions[String(req.body?.action)];
  if (!t) throw new HttpError(400, 'action must be approve, reject, suspend or reinstate');
  const aff = await getAffiliate(affId);
  if (!aff || !t.from.includes(aff.status)) throw new HttpError(409, `Can’t ${req.body.action} from ${aff?.status ?? 'none'}`);
  const note = text(req.body?.note, 500);
  const now = Date.now();
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: affKey(affId),
      UpdateExpression: 'SET #s = :to, note = :note, decidedAt = :n, decidedBy = :by, gsi1sk = :gs',
      ConditionExpression: '#s = :from',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':to': t.to, ':from': aff.status, ':note': note, ':n': now, ':by': adminId, ':gs': `${t.to}#${aff.appliedAt}` },
    }),
  );
  await audit({ entity: `affiliate:${affId}`, action: `affiliate.${t.to}`, actor: `admin:${adminId}`, data: { note, from: aff.status } });
  if (t.to === 'approved' && aff.status === 'applied') {
    // A first link, ready to share.
    const record = await createCode(affId, 'affiliate', 'default');
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `D#${affId}`, sk: `AL#${record.code}`, code: record.code, campaign: 'default', createdAt: now } }));
    if (aff.email) {
      await notify(aff.email, 'Welcome to the Lens affiliate program', `You're approved! Your link: ${env.webOrigin}/go/${record.code}\n\nSee your dashboard in the Lens app: Settings → Affiliate program.`).catch((e) =>
        console.error('affiliate email', e),
      );
    }
  }
  return json(200, { status: t.to });
}

/** GET /v1/admin/audit?entity=affiliate:<id> */
export async function auditTrail(req: Req): Promise<Res> {
  const entity = text(req.query.entity, 200);
  if (!entity) throw new HttpError(400, 'entity is required');
  const rows = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': `AU#${entity}` },
      ScanIndexForward: false,
      Limit: 200,
    }),
  );
  return json(200, { events: (rows.Items ?? []).map(({ pk: _pk, sk: _sk, ...e }) => e) });
}
