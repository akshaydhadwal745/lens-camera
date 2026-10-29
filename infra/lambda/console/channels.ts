// Growth by install channel (docs/growth/growth-engine.md M2/M4): for the accounts installed in a
// window, per channel (PROFILE.acquisition): installs, first backup, sign-in, D1/D7/D30 retention
// (active on exactly day N after install, UTC days from ACT# rows), paying now, storage held and its
// estimated monthly cost. Pure, so it's tested without the table (channels.test.ts).

const DAY = 86_400_000;
const GB = 1024 ** 3;
/** Blended S3 storage cost, USD per GB-month (docs/business/pricing-models-evaluation.md). An estimate until the bill is non-zero. */
export const STORAGE_USD_PER_GB_MONTH = 0.012;

export type ChannelAccount = {
  createdAt: number;
  acquisition?: { source?: string; medium?: string; campaign?: string };
  usedBytes?: number;
  paying?: boolean;
  uploadedAt?: number;
  signedInAt?: number;
  activeDays: Set<string>; // YYYY-MM-DD
};

export type Rate = { reached: number; eligible: number; rate: number | null };
export type ChannelRow = {
  channel: string;
  installs: number;
  backedUp: Rate;
  signedIn: Rate;
  d1: Rate;
  d7: Rate;
  d30: Rate;
  paying: number;
  storageGB: number;
  storageUsdPerMonth: number;
};

export const channelOf = (a?: ChannelAccount['acquisition']) => (a?.source ? (a.medium ? `${a.source} / ${a.medium}` : a.source) : 'unknown (before 2026-10-29)');

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const rate = (reached: number, eligible: number): Rate => ({ reached, eligible, rate: eligible ? reached / eligible : null });

/** Active on calendar day N after the install day; only accounts installed at least N full days ago count. */
function dayN(accounts: ChannelAccount[], n: number, now: number): Rate {
  const todayStart = Date.parse(`${dayKey(now)}T00:00:00Z`);
  const eligible = accounts.filter((a) => Date.parse(`${dayKey(a.createdAt)}T00:00:00Z`) + n * DAY < todayStart);
  const reached = eligible.filter((a) => a.activeDays.has(dayKey(Date.parse(`${dayKey(a.createdAt)}T00:00:00Z`) + n * DAY)));
  return rate(reached.length, eligible.length);
}

export function byChannel(accounts: ChannelAccount[], now: number): ChannelRow[] {
  const groups = new Map<string, ChannelAccount[]>();
  for (const a of accounts) groups.set(channelOf(a.acquisition), [...(groups.get(channelOf(a.acquisition)) ?? []), a]);
  const rows = [...groups.entries()].map(([channel, list]) => {
    const bytes = list.reduce((s, a) => s + (a.usedBytes ?? 0), 0);
    return {
      channel,
      installs: list.length,
      backedUp: rate(list.filter((a) => a.uploadedAt !== undefined).length, list.length),
      signedIn: rate(list.filter((a) => a.signedInAt !== undefined).length, list.length),
      d1: dayN(list, 1, now),
      d7: dayN(list, 7, now),
      d30: dayN(list, 30, now),
      paying: list.filter((a) => a.paying).length,
      storageGB: Math.round((bytes / GB) * 10) / 10,
      storageUsdPerMonth: Math.round((bytes / GB) * STORAGE_USD_PER_GB_MONTH * 100) / 100,
    };
  });
  return rows.sort((a, b) => b.installs - a.installs);
}
