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
  /** Signed-in accounts. */
  quotaBytes: Number(process.env.QUOTA_BYTES),
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
  /** Append-only audit trail (S3 Object Lock). */
  auditBucket: process.env.AUDIT_BUCKET ?? '',
  /** Accounts (by email) allowed into /admin. */
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
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
};

export type Res = APIGatewayProxyStructuredResultV2;

export function parseEvent(event: APIGatewayProxyEventV2): Req {
  let body: unknown = undefined;
  if (event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
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

/** Lens storage limit: guests get less until they sign in; referral bonuses add on top. */
export function quotaFor(identity: { email?: string; bonusBytes?: number }): number {
  return (identity.email ? env.quotaBytes : env.guestQuotaBytes) + Math.max(0, identity.bonusBytes ?? 0);
}

/** Throws 413 if `bytes` more would exceed this identity's Lens storage. */
export function checkQuota(identity: { email?: string; bonusBytes?: number; usedBytes: number }, bytes: number, what = 'Lens storage is full') {
  if (bytes <= 0 || identity.usedBytes + bytes <= quotaFor(identity)) return;
  if (!identity.email) {
    const gb = Math.round(env.guestQuotaBytes / 1024 ** 3);
    const full = Math.round(env.quotaBytes / 1024 ** 3);
    throw new HttpError(413, `Your free ${gb} GB guest storage is full. Sign in to get ${full} GB free.`, 'guest-quota');
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
