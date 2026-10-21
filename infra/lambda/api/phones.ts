// Which phones Lens runs on (Admin → Phones). Built from the anonymous camera
// capabilities report the app sends once per app build and at least once a month
// (src/lib/diagnostics.ts, privacy policy "camera diagnostics"):
//
//   PHONES#<YYYY-MM>  P#<phone>  → a short summary of that phone (model, Android, RAM,
//                                  camera level, OIS, 4K, maker Night, slow motion…)
//
// <phone> is a random ID the app makes for that month only: it isn't the account,
// changes every month and can't be linked across months. Counts only are shown.
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, randomId, Req, Res } from './lib';

const KEEP_SECONDS = 400 * 86400;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const PHONE = /^[A-Za-z0-9_-]{8,40}$/;

type Camera = {
  facing?: string;
  level?: string;
  megapixels?: number;
  ois?: boolean;
  flash?: boolean;
  videoQualities?: string[];
  hdrVideo?: string[];
  extensions?: string[];
  features?: { slowMotion?: unknown; slowMotionCamera2?: unknown; fps60?: Record<string, number>; lowLightBoost?: boolean };
};
type Capabilities = {
  device?: { manufacturer?: string; model?: string; android?: string; api?: number; abis?: string[]; ramGB?: number; soc?: string | null; hardware?: string; concurrentCameras?: boolean };
  tier?: string;
  lenses?: { id?: string; factor?: number }[];
  cameras?: Camera[];
  videoEncoders?: Record<string, { ['4k30']?: boolean; ['4k60']?: boolean }>;
};

const str = (v: unknown, max = 60) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** The fields Admin → Phones counts, from one capabilities report. */
export function phoneSummary(report: Capabilities, build: { apk?: unknown; code?: unknown } | undefined) {
  const d = report.device ?? {};
  const cams = Array.isArray(report.cameras) ? report.cameras : [];
  const back = cams.find((c) => c.facing === 'back') ?? cams[0];
  const front = cams.find((c) => c.facing === 'front');
  const encoders = report.videoEncoders ?? {};
  return {
    manufacturer: str(d.manufacturer)?.toLowerCase(),
    model: str(d.model),
    android: str(d.android, 10),
    api: typeof d.api === 'number' ? d.api : undefined,
    ramGB: typeof d.ramGB === 'number' ? Math.round(d.ramGB * 10) / 10 : undefined,
    bits64: Array.isArray(d.abis) ? d.abis.includes('arm64-v8a') : undefined,
    chip: str(d.soc ?? d.hardware, 40),
    tier: str(report.tier, 20),
    backLevel: str(back?.level, 12),
    backMp: typeof back?.megapixels === 'number' ? Math.round(back.megapixels) : undefined,
    frontMp: typeof front?.megapixels === 'number' ? Math.round(front.megapixels) : undefined,
    ois: back?.ois === true,
    flash: back?.flash === true,
    lenses: Array.isArray(report.lenses) ? report.lenses.length : undefined,
    video4k: Object.values(encoders).some((e) => e?.['4k30']) && (back?.videoQualities ?? []).some((q) => /2160|uhd|4k/i.test(q)),
    hdrVideo: (back?.hdrVideo ?? []).length > 0,
    makerNight: (back?.extensions ?? []).some((e) => /night/i.test(e)),
    slowMotion: !!back?.features?.slowMotion,
    slowMotionCamera2: !!back?.features?.slowMotionCamera2,
    lowLightBoost: back?.features?.lowLightBoost === true,
    concurrentCameras: typeof d.concurrentCameras === 'boolean' ? d.concurrentCameras : undefined,
    build: str(build?.code, 10) ?? str(build?.apk, 10),
  };
}

/** Called with every diagnostics upload: keeps this month's summary row for the phone. */
export async function recordPhone(body: { device?: unknown; build?: unknown; events?: unknown[]; phone?: unknown }) {
  const cap = (body.events ?? []).find((e) => (e as { kind?: string })?.kind === 'capabilities') as { details?: Capabilities } | undefined;
  if (!cap?.details) return;
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  // Older apps send no monthly ID: each of their reports counts once.
  const phone = typeof body.phone === 'string' && PHONE.test(body.phone) ? body.phone : `x${randomId(10)}`;
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: { pk: `PHONES#${month}`, sk: `P#${phone}`, ...phoneSummary(cap.details, body.build as never), at: now.getTime(), ttl: Math.floor(now.getTime() / 1000) + KEEP_SECONDS },
    }),
  );
}

type Row = ReturnType<typeof phoneSummary>;

function countBy(rows: Row[], key: (r: Row) => string | undefined, top = 15) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? 'unknown';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([label, count]) => ({ label, count }));
}

const share = (rows: Row[], test: (r: Row) => boolean | undefined) => ({
  yes: rows.filter((r) => test(r) === true).length,
  known: rows.filter((r) => test(r) !== undefined).length,
});

const ramBucket = (gb?: number) => (gb === undefined ? undefined : gb < 3 ? '< 3 GB' : gb < 4.5 ? '3–4 GB' : gb < 6.5 ? '6 GB' : gb < 8.5 ? '8 GB' : '12 GB +');

/** GET /admin/phones?month=YYYY-MM: counts of the phones Lens ran on that month. */
export async function adminPhones(req: Req): Promise<Res> {
  const month = typeof req.query?.month === 'string' && MONTH.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const rows: Row[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `PHONES#${month}` }, ExclusiveStartKey: start }),
    );
    for (const i of r.Items ?? []) rows.push(i as Row);
    start = r.LastEvaluatedKey;
    if (rows.length > 100_000) throw new HttpError(413, 'Too many phones for one month: narrow the query');
  } while (start);
  return json(200, {
    month,
    phones: rows.length,
    models: countBy(rows, (r) => [r.manufacturer, r.model].filter(Boolean).join(' ') || undefined, 25),
    brands: countBy(rows, (r) => r.manufacturer),
    android: countBy(rows, (r) => (r.android ? `Android ${r.android}` : undefined)),
    ram: countBy(rows, (r) => ramBucket(r.ramGB)),
    tiers: countBy(rows, (r) => r.tier),
    cameraLevel: countBy(rows, (r) => r.backLevel),
    chips: countBy(rows, (r) => r.chip),
    builds: countBy(rows, (r) => (r.build ? `dev-${r.build}` : undefined)),
    features: {
      bits64: share(rows, (r) => r.bits64),
      ois: share(rows, (r) => r.ois),
      flash: share(rows, (r) => r.flash),
      video4k: share(rows, (r) => r.video4k),
      hdrVideo: share(rows, (r) => r.hdrVideo),
      makerNight: share(rows, (r) => r.makerNight),
      slowMotion: share(rows, (r) => r.slowMotion),
      slowMotionCamera2: share(rows, (r) => r.slowMotionCamera2),
      lowLightBoost: share(rows, (r) => r.lowLightBoost),
      concurrentCameras: share(rows, (r) => r.concurrentCameras),
    },
  });
}
