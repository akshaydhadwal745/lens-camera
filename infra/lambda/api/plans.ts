// Paid plans and what happens when payment stops (owner decision 2026-10-21; docs/business/payments.md).
// The plan lives on the profile, whoever took the money (Razorpay on the website/APK, later Google
// Play in the Play app, or a manual grant from the Lens Console):
//
//   PROFILE.plan = { id, bytes, status: 'active' | 'grace' | 'lapsed', provider, ref?, periodEnd,
//                    graceUntil?, lapsedAt?, cancelled?, startedAt, updatedAt }
//
//   active  → the plan's storage (e.g. 50 GB) + invite storage.
//   grace   → renewal failed or didn't arrive: 7 more days at the plan's storage, payment retried,
//             reminders on day 0, 3 and 6 (push + email).
//   lapsed  → back to Free (10 GB + invite storage). Nothing is deleted: above the limit only new
//             backups pause (see over-limit.ts). Paying again restores the plan at once.
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { audit } from './audit';
import { ddb, env, HttpError } from './lib';

const DAY = 86_400_000;
export const GRACE_DAYS = 7;
/** Over the limit this long → what's above it is deleted (over-limit.ts; owner decision: 5 months). */
export const DELETE_AFTER_DAYS = 150;
export const deletionAt = (overLimitSince: number) => overLimitSince + DELETE_AFTER_DAYS * DAY;
const GB = 1024 ** 3;

export const PLANS: Record<string, { name: string; bytes: number }> = {
  plus50: { name: 'Lens Plus · 50 GB', bytes: 50 * GB },
  max200: { name: 'Lens Max · 200 GB', bytes: 200 * GB },
};

export type PlanState = {
  id: string;
  bytes: number;
  status: 'active' | 'grace' | 'lapsed';
  provider: 'razorpay' | 'play' | 'manual';
  ref?: string;
  periodEnd: number;
  graceUntil?: number;
  lapsedAt?: number;
  cancelled?: boolean;
  startedAt: number;
  updatedAt: number;
};

/** The plan gives its storage now (active, or still within grace). */
export function planActive(plan: PlanState | undefined, now = Date.now()): boolean {
  if (!plan) return false;
  if (plan.status === 'active') return plan.periodEnd + DAY > now; // a day's slack for renewals
  if (plan.status === 'grace') return (plan.graceUntil ?? 0) > now;
  return false;
}

const key = (id: string) => ({ pk: `D#${id}`, sk: 'PROFILE' });

async function save(accountId: string, plan: PlanState, extra: Record<string, unknown> = {}) {
  const names: Record<string, string> = { '#p': 'plan' };
  const values: Record<string, unknown> = { ':p': plan };
  const sets = ['#p = :p'];
  const removes: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    names[`#${k}`] = k;
    if (v === undefined) removes.push(`#${k}`);
    else {
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
  }
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: key(accountId),
      UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function getPlan(accountId: string): Promise<PlanState | undefined> {
  const r = await ddb.send(new GetCommand({ TableName: env.table, Key: key(accountId), ProjectionExpression: '#p', ExpressionAttributeNames: { '#p': 'plan' } }));
  return r.Item?.plan as PlanState | undefined;
}

/** A payment went through (first one or a renewal): the plan is active until `periodEnd`. */
export async function activatePlan(
  accountId: string,
  input: { id: string; periodEnd: number; provider: PlanState['provider']; ref?: string },
  actor: string,
): Promise<PlanState> {
  const def = PLANS[input.id];
  if (!def) throw new HttpError(400, 'Unknown plan');
  const now = Date.now();
  const before = await getPlan(accountId);
  const plan: PlanState = {
    id: input.id,
    bytes: def.bytes,
    status: 'active',
    provider: input.provider,
    ref: input.ref ?? before?.ref,
    periodEnd: input.periodEnd,
    startedAt: before && before.status !== 'lapsed' ? before.startedAt : now,
    updatedAt: now,
  };
  // Paying again ends any over-limit countdown (over-limit.ts re-checks every day).
  await save(accountId, plan, { overLimitSince: undefined });
  await audit({ entity: `plan:${accountId}`, action: before?.status === 'active' ? 'plan.renewed' : 'plan.activated', actor, data: { id: plan.id, periodEnd: plan.periodEnd, provider: plan.provider } });
  return plan;
}

/** A renewal failed: 7 days of grace at the plan's storage (payment is retried meanwhile). */
export async function paymentFailed(accountId: string, actor: string, now = Date.now()): Promise<PlanState | undefined> {
  const plan = await getPlan(accountId);
  if (!plan || plan.status !== 'active') return plan;
  const next: PlanState = { ...plan, status: 'grace', graceUntil: Math.max(now, plan.periodEnd) + GRACE_DAYS * DAY, updatedAt: now };
  await save(accountId, next);
  await audit({ entity: `plan:${accountId}`, action: 'plan.grace', actor, data: { graceUntil: next.graceUntil } });
  return next;
}

/** The person cancelled: the plan runs to the end of what they paid for, then ends (no grace). */
export async function cancelPlan(accountId: string, actor: string): Promise<PlanState | undefined> {
  const plan = await getPlan(accountId);
  if (!plan || plan.status === 'lapsed') return plan;
  const next: PlanState = { ...plan, cancelled: true, updatedAt: Date.now() };
  await save(accountId, next);
  await audit({ entity: `plan:${accountId}`, action: 'plan.cancelled', actor });
  return next;
}

/** Back to Free now (grace over, cancelled plan ended, or a refund). */
export async function lapsePlan(accountId: string, actor: string, now = Date.now()): Promise<PlanState | undefined> {
  const plan = await getPlan(accountId);
  if (!plan || plan.status === 'lapsed') return plan;
  const next: PlanState = { ...plan, status: 'lapsed', lapsedAt: now, updatedAt: now };
  await save(accountId, next);
  await audit({ entity: `plan:${accountId}`, action: 'plan.lapsed', actor });
  return next;
}

/**
 * Every 15 minutes (Maintenance): renewals that never arrived → grace; grace or cancelled plans that
 * ran out → lapsed. Returns what changed (the notifications come from lifecycle.ts).
 */
export async function advancePlans(accounts: { id: string; plan?: PlanState }[], now = Date.now()) {
  const changed: { id: string; to: PlanState['status'] }[] = [];
  for (const a of accounts) {
    const p = a.plan;
    if (!p || p.status === 'lapsed') continue;
    if (p.status === 'active' && p.periodEnd + DAY <= now) {
      if (p.cancelled) await lapsePlan(a.id, 'system', now);
      else await paymentFailed(a.id, 'system', now);
      changed.push({ id: a.id, to: p.cancelled ? 'lapsed' : 'grace' });
    } else if (p.status === 'grace' && (p.graceUntil ?? 0) <= now) {
      await lapsePlan(a.id, 'system', now);
      changed.push({ id: a.id, to: 'lapsed' });
    }
  }
  return changed;
}
