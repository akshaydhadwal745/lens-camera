import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { getSignedUrl as signCloudFront } from '@aws-sdk/cloudfront-signer';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export const env = {
  table: process.env.TABLE!,
  bucket: process.env.BUCKET!,
  cdnDomain: process.env.CDN_DOMAIN!,
  keyPairId: process.env.CF_KEY_PAIR_ID!,
  privateKeyParam: process.env.CF_PRIVATE_KEY_PARAM!,
  /** Signed-in accounts during their welcome period (owner decision 2026-10-21: 40 GB, 3 months). */
  quotaBytes: Number(process.env.QUOTA_BYTES),
  /** Signed-in accounts after the welcome period: free forever (10 GB). */
  freeQuotaBytes: Number(process.env.FREE_QUOTA_BYTES ?? 10 * 1024 ** 3),
  /** How long the welcome lasts from the first sign-in. */
  welcomeMs: Number(process.env.WELCOME_DAYS ?? 90) * 86_400_000,
  /** Referral bonuses count up to this much (docs/business/business-model-and-roadmap.md). */
  maxBonusBytes: Number(process.env.MAX_BONUS_BYTES ?? 100 * 1024 ** 3),
  /** Guests (not signed in), pooled per device fingerprint. */
  guestQuotaBytes: Number(process.env.GUEST_QUOTA_BYTES ?? 5 * 1024 ** 3),
  maxFileBytes: Number(process.env.MAX_FILE_BYTES),
  /** Verified SES sender for sign-in codes (empty = email sign-in off). */
  codeSender: process.env.CODE_SENDER ?? '',
  transcodeQueueSpot: process.env.TRANSCODE_QUEUE_SPOT ?? '',
  transcodeQueueOnDemand: process.env.TRANSCODE_QUEUE_ONDEMAND ?? '',
  transcodeJob: process.env.TRANSCODE_JOB ?? '',
  streamKeyParam: process.env.STREAM_KEY_PARAM ?? '/lens/stream/token-key',
  /** The website (https://lens.instagrowapp.com): web sign-in returns here. */
  webOrigin: process.env.WEB_ORIGIN ?? '',
  /** Sent only by our CloudFront (/api): proves the viewer headers are real. */
  edgeSecret: process.env.EDGE_SECRET ?? '',
  /** The website bucket (share-link page template for previews, links.ts linkPage). */
  webBucket: process.env.WEB_BUCKET ?? '',
  /** Screenshots users attach to feedback (the only user images the Lens Console can open). */
  feedbackBucket: process.env.FEEDBACK_BUCKET ?? '',
  /** Append-only audit trail (S3 Object Lock). */
  auditBucket: process.env.AUDIT_BUCKET ?? '',
  /** Accounts (by email) allowed into /admin. */
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  /** Where contact-form messages are emailed (comma-separated); defaults to the admins. */
  contactTo: (process.env.CONTACT_TO ?? '').split(',').map((e) => e.trim()).filter(Boolean),
  /** Google Play listing for invite/affiliate links; empty until the app is published. */
  playUrl: process.env.PLAY_URL ?? '',
  /** Runs long background jobs (account deletion). */
  maintenanceFunction: process.env.MAINTENANCE_FUNCTION ?? process.env.AWS_LAMBDA_FUNCTION_NAME ?? '',
};

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
export const s3 = new S3Client({});
const ssm = new SSMClient({});

// ---------- HTTP helpers ----------

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason for the app (e.g. "guest-quota"). */
    public code?: string,
  ) {
    super(message);
  }
}

export type Req = {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  body: any;
  headers: Record<string, string | undefined>;
  /** Request cookies (the website's session cookie arrives via CloudFront `/api`). */
  cookies: Record<string, string>;
  /** The visitor's IP: CloudFront's viewer address when proxied, else the direct caller. */
  sourceIp?: string;
  /** Approximate city (CloudFront geo header), for "who is signing in" prompts. */
  city?: string;
  /** The body as sent (webhook signatures are over these exact bytes). */
  rawBody?: string;
};

export type Res = APIGatewayProxyStructuredResultV2;

export function parseEvent(event: APIGatewayProxyEventV2): Req {
  let body: unknown = undefined;
  let rawBody: string | undefined;
  if (event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    rawBody = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Body must be JSON');
    }
  }
  const headers = event.headers ?? {};
  const cookies: Record<string, string> = {};
  for (const c of event.cookies ?? []) {
    const i = c.indexOf('=');
    if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  }
  // Behind CloudFront (/api) the direct caller is CloudFront; its viewer
  // header ("ip:port", IPv6 too) holds the real visitor. Trusted only with our
  // edge secret, so a direct caller can't fake its address.
  const viaEdge = !!env.edgeSecret && safeEqual(headers['x-lens-edge'] ?? '', env.edgeSecret);
  const viewer = viaEdge ? headers['cloudfront-viewer-address'] : undefined;
  const viewerIp = viewer ? viewer.slice(0, viewer.lastIndexOf(':')) : undefined;
  const city = viaEdge ? headers['cloudfront-viewer-city'] : undefined;
  return {
    method: event.requestContext.http.method,
    path: event.rawPath.replace(/\/+$/, '') || '/',
    query: event.queryStringParameters ?? {},
    body: body ?? {},
    headers,
    cookies,
    sourceIp: viewerIp || event.requestContext.http.sourceIp,
    city: city ? decodeURIComponent(city) : undefined,
    rawBody,
  };
}

// ---------- Website session cookie ----------
// The website keeps its session in an HttpOnly cookie (scripts can't read it,
// unlike localStorage). __Host- prefix: Secure, Path=/, no Domain, so only this
// exact host gets it. Phones keep using Authorization: Bearer.

export const WEB_COOKIE = '__Host-lens';
const WEB_SESSION_DAYS = 30;

export function sessionCookie(token: string): string {
  return `${WEB_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${WEB_SESSION_DAYS * 86400}`;
}

export function clearedCookie(): string {
  return `${WEB_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** A JSON response that also sets cookies. */
export function withCookies(res: Res, cookies: string[]): Res {
  return { ...res, cookies: [...(res.cookies ?? []), ...cookies] };
}

/** Signed-in accounts made before the new storage plan (2026-10-22): their welcome ends 3 months after it. */
export const PLAN_CHANGE_WELCOME_UNTIL = Date.UTC(2026, 9, 22) + 90 * 86_400_000;

/** After the welcome, backups keep their 40 GB for this long (soft landing, with reminders). */
export const LANDING_MS = 14 * 86_400_000;
/** Welcome storage still applies: the welcome period or its 14-day soft landing. */
export const welcomeStorage = (identity: { welcomeUntil?: number }, now = Date.now()) => (identity.welcomeUntil ?? 0) + LANDING_MS > now;

/** Is this signed-in account still in its welcome period? */
export const inWelcome = (identity: { welcomeUntil?: number }, now = Date.now()) => (identity.welcomeUntil ?? 0) > now;

/**
 * Lens storage limit (owner decision 2026-10-21): guests 5 GB; signed in 40 GB for the welcome
 * period (3 months from the first sign-in), then 10 GB free forever; referral bonuses (≤ 100 GB) on
 * top. Backups to the user's own storage don't count. Nothing is ever deleted when the limit
 * drops: new Lens backups just pause above it.
 */
type QuotaInput = {
  email?: string;
  bonusBytes?: number;
  welcomeUntil?: number;
  plan?: { status: string; bytes: number; periodEnd: number; graceUntil?: number };
  /** Extra storage above the plan, paid per GB used (extra-storage.ts): up to the cap the person set. */
  extra?: { capGB?: number };
};

const planPaid = (p: QuotaInput['plan'], now: number) =>
  !!p && ((p.status === 'active' && p.periodEnd + 86_400_000 > now) || (p.status === 'grace' && (p.graceUntil ?? 0) > now));

export function quotaFor(identity: QuotaInput, now = Date.now()): number {
  const bonus = Math.min(env.maxBonusBytes, Math.max(0, identity.bonusBytes ?? 0));
  if (!identity.email) return env.guestQuotaBytes + bonus;
  // A paid plan (plans.ts): its storage while active or in its 7-day grace.
  const p = identity.plan;
  if (planPaid(p, now)) return Math.max(p!.bytes, welcomeStorage(identity, now) ? env.quotaBytes : 0) + bonus + extraAllowance(identity, now);
  return (welcomeStorage(identity, now) ? env.quotaBytes : env.freeQuotaBytes) + bonus;
}

/** Extra storage the person allowed above their plan (only while the plan gives its storage). */
export function extraAllowance(identity: QuotaInput, now = Date.now()): number {
  return planPaid(identity.plan, now) ? Math.max(0, identity.extra?.capGB ?? 0) * 1024 ** 3 : 0;
}

/** Throws 413 if `bytes` more would exceed this identity's Lens storage. */
export function checkQuota(
  identity: QuotaInput & { usedBytes: number },
  bytes: number,
  what = 'Lens storage is full',
) {
  if (bytes <= 0 || identity.usedBytes + bytes <= quotaFor(identity)) return;
  if (!identity.email) {
    const gb = Math.round(env.guestQuotaBytes / 1024 ** 3);
    const full = Math.round(env.quotaBytes / 1024 ** 3);
    throw new HttpError(413, `Your free ${gb} GB guest storage is full. Sign in to get ${full} GB free for 3 months.`, 'guest-quota');
  }
  const paid = planPaid(identity.plan, Date.now());
  if (paid && extraAllowance(identity) > 0) {
    throw new HttpError(413, 'You reached the extra storage limit you set. Everything stays safe; new photos wait on your phone. Raise the limit in Lens Plus → Extra storage, or free up space.', 'extra-cap');
  }
  if (!paid && !welcomeStorage(identity)) {
    // Free (after the welcome or a paid plan): nothing is deleted, new backups wait (over-limit.ts).
    throw new HttpError(413, 'Your free storage is full. Everything you have stays safe; new photos wait on your phone. Get more space, invite friends, or back up to your own storage.', 'free-quota');
  }
  throw new HttpError(413, what, 'quota');
}

/** Fixed-window counter (per hour); throws 429 past the limit. */
export async function rateLimit(scope: string, limit: number, message = 'Too many requests. Try again in an hour.') {
  const hour = Math.floor(Date.now() / 3_600_000);
  const result = await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `RATE#${scope}#${hour}`, sk: 'COUNT' },
      UpdateExpression: 'ADD #c :one SET #ttl = :ttl',
      ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':ttl': (hour + 2) * 3600 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  if ((result.Attributes?.count ?? 0) > limit) throw new HttpError(429, message);
}

export function json(status: number, data: unknown): Res {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(data),
  };
}

// ---------- Tokens ----------
// Token format: <deviceId>.<tokenId>.<secret>. Only sha256(secret) is stored.

export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------- Cursors ----------

export function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  return key ? Buffer.from(JSON.stringify(key)).toString('base64url') : null;
}

export function decodeCursor(cursor: string | undefined): Record<string, any> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid cursor');
  }
}

// ---------- CloudFront signed URLs ----------

let privateKey: Promise<string> | null = null;

function getPrivateKey(): Promise<string> {
  if (!privateKey) {
    privateKey = ssm
      .send(new GetParameterCommand({ Name: env.privateKeyParam, WithDecryption: true }))
      .then((r) => r.Parameter!.Value!)
      .catch((e) => {
        privateKey = null;
        throw e;
      });
  }
  return privateKey;
}

/** Key for signing short-lived values (e.g. OAuth state), derived from the CloudFront key. */
export async function derivedKey(purpose: string): Promise<Buffer> {
  return createHash('sha256').update(`${await getPrivateKey()}:${purpose}`).digest();
}

const params = new Map<string, Promise<string | undefined>>();

/** SSM SecureString (cached); undefined if it doesn't exist (feature not configured). */
export function getParam(name: string): Promise<string | undefined> {
  let value = params.get(name);
  if (!value) {
    value = ssm
      .send(new GetParameterCommand({ Name: name, WithDecryption: true }))
      .then((r) => r.Parameter?.Value)
      .catch((e) => {
        if (e?.name === 'ParameterNotFound') return undefined;
        params.delete(name);
        throw e;
      })
      .then((v) => {
        if (v === undefined) params.delete(name); // look again next time (it may get configured)
        return v;
      });
    params.set(name, value);
  }
  return value;
}

export const URL_TTL_SECONDS = 6 * 3600;

export async function signMediaUrl(key: string): Promise<string> {
  // Round expiry down to the hour so repeated listings return identical URLs,
  // which lets the app's image cache hit.
  const hour = 3600 * 1000;
  const expires = Math.floor((Date.now() + URL_TTL_SECONDS * 1000) / hour) * hour;
  return signCloudFront({
    url: `https://${env.cdnDomain}/${key}`,
    keyPairId: env.keyPairId,
    privateKey: await getPrivateKey(),
    dateLessThan: new Date(expires).toISOString(),
  });
}
