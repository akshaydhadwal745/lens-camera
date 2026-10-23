// Lifecycle notifications (docs/design/notifications.md): useful reminders, each sent once, at
// about 10:00 on the phone's clock, within the limits in push.ts (deliver):
//   welcome_ending   14, 3 and 1 days before the 40 GB welcome ends (account; + email at 14 and 1)
//   payment_failed   grace day 0, 3 and 6; plan_ended once (account, + email)
//   plus_first_charge 3 days before a locked-in Lens Plus is first charged (account, + email; RBI e-mandate)
//   landing_ending   3 days before the soft landing ends, if backups would pause (account)
//   over_limit       monthly while over the limit; deletion_notice 90/30/7/1 days before (account)
//   weekly_summary   Sundays, if something was backed up that week (summary)
//   on_this_day      photos from this date in earlier years, at most weekly (memories)
//   recap_ready      a trip or event recap just finished (memories)
// Sent markers: D#<id> NL#<name> { at }.
import { PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, LANDING_MS, PLAN_CHANGE_WELCOME_UNTIL, quotaFor } from './lib';
import { deleteAboveLimit, trackOverLimit } from './over-limit';
import { deletionAt, planActive, PLANS, PlanState } from './plans';
import { OFFERS, SubState } from './payments';
import { bumpStat, deliver, localHour } from './push';
import { findRecaps, RecapInput } from './recap-detect';
import { notify as email } from './referrals';
import { Row, scanTable } from './table-scan';
import { testAccounts } from './test-accounts';

const DAY = 86_400_000;
const SEND_HOUR = 10;
const GB = 1024 ** 3;

const FIELDS = [
  'pk', 'sk', 'email', 'createdAt', 'usedBytes', 'bonusBytes', 'welcomeUntil', 'plan', 'sub', 'overLimitSince', 'test', 'emulator', 'guestId', 'tz',
  'kind', 'status', 'deletedAt', 'size', 'uploadedAt', 'place', 'width', 'height', 'recap', 'previewReady', 'ownerHidden', 'at',
];

const gb = (b: number) => (b >= 10 * GB ? `${Math.round(b / GB)} GB` : b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);
const dateText = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
const isoWeek = (t: number) => {
  const d = new Date(t);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}W${1 + Math.round((d.getTime() - first.getTime()) / 604_800_000)}`;
};

type Account = { id: string; profile: Row; tz?: number; media: Row[]; marks: Map<string, number> };

async function mark(id: string, name: string, now: number) {
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `D#${id}`, sk: `NL#${name}`, at: now, ttl: Math.floor(now / 1000) + 400 * 86400 } }));
}

async function send(a: Account, name: string, markName: string, category: Parameters<typeof deliver>[1], msg: { title: string; body: string; route: string }, now: number) {
  const r = await deliver(a.id, category, msg, { data: { lifecycle: name, kind: 'lifecycle' }, now, ignoreQuiet: true });
  if (r === 'sent' || r === 'off' || r === 'no-device') await mark(a.id, markName, now); // decided: don't retry
  await bumpStat(`${r}#${name}`, now);
  return r;
}

/** Hourly (Maintenance, first run of each hour): accounts whose local time is 10:00. */
export async function runLifecycle(now: number, deadline: number, onlyOwner?: string): Promise<Record<string, number>> {
  const rows = await scanTable(FIELDS);
  const profiles = rows.filter((r) => r.sk === 'PROFILE' && String(r.pk).startsWith('D#'));
  const test = testAccounts(profiles, rows.filter((r) => r.sk === 'DEVICE' && String(r.pk).startsWith('FP#')));
  const accounts = new Map<string, Account>();
  for (const p of profiles) {
    const id = String(p.pk).slice(2);
    if (onlyOwner ? id !== onlyOwner : test.has(id)) continue;
    accounts.set(id, { id, profile: p, media: [], marks: new Map() });
  }
  for (const r of rows) {
    const pk = String(r.pk);
    if (!pk.startsWith('D#')) continue;
    const a = accounts.get(pk.slice(2));
    if (!a) continue;
    const sk = String(r.sk);
    if (sk.startsWith('PUSH#')) a.tz = typeof r.tz === 'number' ? r.tz : a.tz;
    else if (sk.startsWith('M#')) a.media.push(r);
    else if (sk.startsWith('NL#')) a.marks.set(sk.slice(3), r.at ?? 0);
  }

  const counts: Record<string, number> = {};
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  for (const a of accounts.values()) {
    if (Date.now() > deadline) break;
    if (!onlyOwner && localHour(a.tz, now) !== SEND_HOUR) continue;
    const p = a.profile;
    const local = new Date(now + (a.tz ?? 330) * 60_000);

    // ---- storage plan (account notices: can't be turned off; push + email) ----
    if (p.email) {
      const welcomeUntil = p.welcomeUntil ?? PLAN_CHANGE_WELCOME_UNTIL;
      p.welcomeUntil = welcomeUntil;
      const plan = p.plan as PlanState | undefined;
      const paid = planActive(plan, now);
      const free = env.freeQuotaBytes + Math.min(env.maxBonusBytes, p.bonusBytes ?? 0);
      const used = p.usedBytes ?? 0;
      const notice = async (name: string, markName: string, title: string, body: string, withEmail: boolean) => {
        if (a.marks.has(markName)) return false;
        const r = await send(a, name, markName, 'account', { title, body, route: '/storage' }, now);
        if (withEmail) await email(p.email, title, `${body}\n\nSee your storage in Lens: Settings → Storage.\n\n— Lens`).catch(() => {});
        if (r === 'sent') count(name);
        return true;
      };

      // Lens Plus locked in during the welcome: 3 days before the first charge (Razorpay also sends
      // its own pre-debit notice 24 h before). Cancel is one tap.
      const sub = p.sub as SubState | undefined;
      if (sub?.status === 'scheduled' && !sub.cancelled && sub.chargeAt && sub.chargeAt - now > 2 * DAY && sub.chargeAt - now <= 3 * DAY) {
        const o = OFFERS[sub.kind];
        const first = sub.intro ? o.introPaise ?? o.paise : o.paise;
        const rupees = (paise: number) => `₹${(paise / 100).toFixed(0)}`;
        if (await notice('plus_first_charge', `plus-charge-${sub.id}`, `Lens Plus starts on ${dateText(sub.chargeAt)}`,
          `Your 40 GB welcome ends then and Lens Plus (50 GB) begins: ${rupees(first)} on ${dateText(sub.chargeAt)}${sub.intro ? `, then ${rupees(o.paise)} a ${o.period}` : ` each ${o.period}`}. Don't want it? Cancel in one tap in Settings → Lens Plus, and nothing is charged.`, true))
          continue;
      }

      // Payment didn't go through: 7 days of grace, reminders on day 0, 3 and 6.
      if (plan?.status === 'grace' && plan.graceUntil && plan.graceUntil > now) {
        const left = plan.graceUntil - now;
        const step = left > 6 * DAY ? 0 : left > 3 * DAY && left <= 4 * DAY ? 3 : left <= DAY ? 6 : -1;
        const planName = PLANS[plan.id]?.name ?? 'your plan';
        if (step >= 0 &&
          (await notice('payment_failed', `pay${step}-${plan.graceUntil}`, step === 6 ? 'Last day to keep your extra storage' : 'Your payment didn’t go through',
            `${planName} keeps working until ${dateText(plan.graceUntil)}. Update your payment to keep it. If not, you go back to ${gb(free)} free: nothing is deleted, but new backups pause above it.`, true)))
          continue;
      }
      // A paid plan ended: once.
      if (plan?.status === 'lapsed' && plan.lapsedAt &&
        (await notice('plan_ended', `lapsed-${plan.lapsedAt}`, 'Your paid storage ended',
          used > free
            ? `You're back to ${gb(free)} free and use ${gb(used)}. Everything stays viewable and downloadable; new backups pause until you pay again, invite friends (+10 GB each) or back up to your own storage.`
            : `You're back to ${gb(free)} free and use ${gb(used)}, so backups carry on. You can pay again any time.`, true)))
        continue;

      if (!paid) {
        // Welcome ending: 14, 3 and 1 days before (then 14 more days of backups: the soft landing).
        const left = welcomeUntil - now;
        for (const days of [14, 3, 1]) {
          if (left > (days - 1) * DAY && left <= days * DAY) {
            const title = days === 1 ? 'Your 40 GB welcome ends tomorrow' : `Your 40 GB welcome ends on ${dateText(welcomeUntil)}`;
            const body = used > free
              ? `You use ${gb(used)}. Backups keep going for 14 more days, then pause above ${gb(free)} free. Nothing is deleted. To keep backing up: Lens Plus (50 GB, from ₹59 a month), invite friends (+10 GB each), or back up to your own Google Drive.`
              : `After that you keep ${gb(free)} free, forever. You use ${gb(used)}, so nothing changes for you.`;
            if (await notice('welcome_ending', `welcome${days}-${welcomeUntil}`, title, body, days !== 3)) break;
          }
        }
        // End of the soft landing (3 days before), only if it will pause backups.
        const landingLeft = welcomeUntil + LANDING_MS - now;
        if (landingLeft > 2 * DAY && landingLeft <= 3 * DAY && used > free &&
          (await notice('landing_ending', `landing-${welcomeUntil}`, `Backups pause above ${gb(free)} on ${dateText(welcomeUntil + LANDING_MS)}`,
            `You use ${gb(used)}. Get more space, invite friends (+10 GB each), or switch new backups to your own storage, and nothing stops. Nothing is ever deleted without months of notice.`, true)))
          continue;
      }

      // Over the limit: the clock, monthly reminders, notices before deletion, and deletion.
      const state = await trackOverLimit(a.id, p, now);
      if (state === 'over' && p.overLimitSince) {
        const since = p.overLimitSince as number;
        const delAt = deletionAt(since);
        const daysLeft = Math.ceil((delAt - now) / DAY);
        if (now >= delAt) {
          const r = await deleteAboveLimit(a.id, now);
          if (r.deleted) {
            count('deleted_above_limit');
            await notice('deleted_above_limit', `deleted-${since}-${new Date(now).toISOString().slice(0, 10)}`, `We removed ${r.deleted} items above your free storage`,
              `As we told you since ${dateText(since)}, ${r.deleted} items (${gb(r.bytes)}) above your ${gb(free)} free storage were deleted, the most recent first. Everything else is safe, and backups work again.`, true);
          }
          continue;
        }
        const pre = [90, 30, 7, 1].find((d) => daysLeft <= d && daysLeft > (d === 1 ? 0 : d === 7 ? 1 : d === 30 ? 7 : 30));
        if (pre && (await notice('deletion_notice', `del${pre}-${since}`, pre === 1 ? 'Tomorrow: photos above your free storage will be deleted' : `In ${pre} days, photos above your free storage will be deleted`,
          `You use ${gb(used)} of ${gb(free)} free since ${dateText(since)}. On ${dateText(delAt)} we'll delete what's above it, your most recent backups first. To keep everything: get more space, invite friends (+10 GB each), move photos to your own Google Drive, or download them.`, true)))
          continue;
        const month = Math.floor((now - since) / (30 * DAY));
        if (await notice('over_limit', `over-${since}-m${month}`, month === 0 ? 'New backups to Lens are paused' : 'Your photos are waiting to be backed up',
          `You use ${gb(used)} of ${gb(free)} free. Everything you have stays safe and viewable; new photos wait on your phone. Get more space, invite friends (+10 GB each), or back up new photos to your own storage.`, month === 0))
          continue;
      }
    }

    const live = a.media.filter((m) => m.status === 'ready' && !m.deletedAt && !m.recap && !m.ownerHidden);

    // ---- weekly summary (Sundays) ----
    const week = `week-${isoWeek(now)}`;
    if (local.getUTCDay() === 0 && !a.marks.has(week)) {
      const recent = live.filter((m) => (m.uploadedAt ?? m.createdAt ?? 0) >= now - 7 * DAY);
      if (recent.length >= 5) {
        const bytes = recent.reduce((s, m) => s + (m.size ?? 0), 0);
        const quota = quotaFor({ email: p.email, bonusBytes: p.bonusBytes, welcomeUntil: p.welcomeUntil ?? PLAN_CHANGE_WELCOME_UNTIL }, now);
        const nearlyFull = quota > 0 && (p.usedBytes ?? 0) / quota > 0.7;
        const body = `${recent.length} photos and videos (${gb(bytes)}) backed up in full quality this week.${nearlyFull || Number(isoWeek(now).split('W')[1]) % 4 === 0 ? ' Invite a friend: +10 GB for you.' : ''}`;
        if ((await send(a, 'weekly_summary', week, 'summary', { title: 'Your week in Lens', body, route: nearlyFull ? '/invite' : '/gallery' }, now)) === 'sent') count('weekly_summary');
        continue;
      }
    }

    // ---- recap ready ----
    const recent45 = live.filter((m) => m.previewReady && now - (m.createdAt ?? 0) < 45 * DAY);
    if (recent45.length >= 12) {
      const input: RecapInput[] = recent45.map((m) => ({ id: String(m.sk).slice(2), kind: m.kind, createdAt: m.createdAt, width: m.width, height: m.height, place: m.place }));
      const fresh = findRecaps(input, now, (a.tz ?? 330) * 60_000).find((r) => now - r.end < 3 * DAY && !a.marks.has(`recap-${r.key}`));
      if (fresh) {
        const r = await send(a, 'recap_ready', `recap-${fresh.key}`, 'memories', { title: `${fresh.title}: your recap is ready`, body: `${fresh.items.length} photos and videos, the best ones made into a short film if you like.`, route: `/recap/${fresh.key}` }, now);
        if (r === 'sent') {
          count('recap_ready');
          continue;
        }
      }
    }

    // ---- on this day (at most weekly) ----
    const lastOtd = [...a.marks.entries()].filter(([k]) => k.startsWith('otd-')).reduce((m, [, t]) => Math.max(m, t), 0);
    if (now - lastOtd > 7 * DAY) {
      const md = `${local.getUTCMonth()}-${local.getUTCDate()}`;
      const thisYear = local.getUTCFullYear();
      const byYear = new Map<number, Row[]>();
      for (const m of live) {
        const d = new Date((m.createdAt ?? 0) + (a.tz ?? 330) * 60_000);
        if (`${d.getUTCMonth()}-${d.getUTCDate()}` !== md || d.getUTCFullYear() >= thisYear) continue;
        byYear.set(d.getUTCFullYear(), [...(byYear.get(d.getUTCFullYear()) ?? []), m]);
      }
      const best = [...byYear.entries()].filter(([, ms]) => ms.length >= 3).sort((x, y) => y[1].length - x[1].length)[0];
      if (best) {
        const [year, ms] = best;
        const city = ms.map((m) => m.place?.city).find(Boolean);
        const ago = thisYear - year;
        const r = await send(a, 'on_this_day', `otd-${thisYear}-${md}`, 'memories', { title: `${ago === 1 ? 'A year ago' : `${ago} years ago`} today`, body: `${ms.length} photos${city ? ` in ${city}` : ''}. Tap to look back.`, route: '/gallery' }, now);
        if (r === 'sent') count('on_this_day');
      }
    }
  }
  return counts;
}
