// Who brought a new user: a friend (user referral, rewarded with storage) or an
// affiliate (rewarded with commission). Shared by both programs, which stay
// separate otherwise (referrals.ts, affiliates.ts).
//
// Links: /r/<code> (friend) and /go/<code> (affiliate) on the website. They
// count the click, remember the code in a cookie (website sign-ups) and send
// Android users to Google Play with the code in the install referrer; the app
// reads it on first launch and sends it with its first registration. Codes can
// also be typed in the app within 7 days of signing up.
//
// One owner per new user, set once (write-once) when the account is created.
import { createHash, randomInt } from 'node:crypto';

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { audit } from './audit';
import { ddb, env, HttpError, json, Req, Res } from './lib';

export type Program = 'referral' | 'affiliate';
export type CodeRecord = { code: string; ownerId: string; program: Program; campaign?: string; createdAt: number };
export type Attribution = { program: Program; code: string; ownerId: string; source: 'install' | 'web' | 'typed'; at: number };

/** No 0/O, 1/I/L: easy to read aloud and type. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-HJ-KM-NP-Z2-9]{6,10}$/;
export const REF_COOKIE = '__Host-lensref';
const REF_COOKIE_DAYS = 30;

const codeKey = (code: string) => ({ pk: `RC#${code}`, sk: 'CODE' });

export function newCodeString(length = 7): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Creates a new unique code (retries on the rare collision). */
export async function createCode(ownerId: string, program: Program, campaign?: string): Promise<CodeRecord> {
  for (let i = 0; i < 6; i++) {
    const record: CodeRecord = { code: newCodeString(), ownerId, program, campaign, createdAt: Date.now() };
    try {
      await ddb.send(new PutCommand({ TableName: env.table, Item: { ...codeKey(record.code), ...record }, ConditionExpression: 'attribute_not_exists(pk)' }));
      return record;
    } catch (error: any) {
      if (error?.name !== 'ConditionalCheckFailedException') throw error;
    }
  }
  throw new HttpError(503, 'Could not create a code, try again');
}

export async function lookupCode(raw: unknown): Promise<CodeRecord | undefined> {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!CODE_RE.test(code)) return undefined;
  const item = (await ddb.send(new GetCommand({ TableName: env.table, Key: codeKey(code) }))).Item;
  return item ? (item as CodeRecord) : undefined;
}

/** Codes from an install referrer ("lens_ref=ABCD234&utm_…"), a cookie ("r:ABCD234") or plain text. */
export function parseRef(raw: unknown): string | undefined {
  const value = String(raw ?? '');
  const m = value.match(/(?:lens_(?:ref|aff)=|^[ra]:)?([A-HJ-KM-NP-Z2-9]{6,10})(?:&|$)/i);
  return m ? m[1].toUpperCase() : undefined;
}

/** Normalised email for "same person" checks (Gmail ignores dots and +tags). */
export function canonicalEmail(email: string): string {
  const [local, domain] = email.toLowerCase().split('@');
  const base = local.split('+')[0];
  const gmail = domain === 'gmail.com' || domain === 'googlemail.com';
  return `${gmail ? base.replace(/\./g, '') : base}@${gmail ? 'gmail.com' : domain}`;
}

export function hashIp(ip: string | undefined): string | undefined {
  return ip ? createHash('sha256').update(`lens-click:${ip}`).digest('base64url').slice(0, 16) : undefined;
}

export function today(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Daily counters per code: clicks, signups, payers, net revenue, commission (paise). */
export async function bumpStats(code: string, fields: Record<string, number>, at = Date.now()) {
  const names: Record<string, string> = {};
  const values: Record<string, number> = {};
  const parts = Object.entries(fields).map(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    return `#f${i} :v${i}`;
  });
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `AS#${code}`, sk: today(at) },
      UpdateExpression: `ADD ${parts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/**
 * GET /v1/r/<code> and /v1/go/<code> (public, via the website /r/ and /go/):
 * counts the click, sets the attribution cookie, redirects to the app.
 */
export async function followLink(req: Req, program: Program, rawCode: string): Promise<Res> {
  const record = await lookupCode(rawCode);
  const ok = !!record && record.program === program && (program === 'referral' || (await affiliateActive(record.ownerId)));
  const site = env.webOrigin || '';
  if (!ok) return redirect(`${site}/`);
  const code = record!.code;
  await bumpStats(code, { clicks: 1 });
  // Raw click kept 30 days for fraud checks (hashed IP, no cookie id).
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: {
        pk: `CL#${code}`,
        sk: `${Date.now()}#${newCodeString(4)}`,
        ip: hashIp(req.sourceIp),
        ua: (req.headers['user-agent'] ?? '').slice(0, 200),
        ttl: Math.floor(Date.now() / 1000) + 30 * 86400,
      },
    }),
  );
  const android = /Android/i.test(req.headers['user-agent'] ?? '');
  const referrer = encodeURIComponent(`lens_${program === 'referral' ? 'ref' : 'aff'}=${code}`);
  const target =
    android && env.playUrl
      ? `${env.playUrl}${env.playUrl.includes('?') ? '&' : '?'}referrer=${referrer}`
      : `${site}/${program === 'referral' ? `?invite=${code}` : `?via=${code}`}`;
  // Lax (not Strict): the cookie must survive arriving from another site's link.
  const cookie = `${REF_COOKIE}=${program === 'referral' ? 'r' : 'a'}:${code}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${REF_COOKIE_DAYS * 86400}`;
  return { statusCode: 302, headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }, cookies: [cookie], body: '' };
}

function redirect(location: string): Res {
  return { statusCode: 302, headers: { location, 'cache-control': 'no-store' }, body: '' };
}

async function affiliateActive(ownerId: string): Promise<boolean> {
  const item = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${ownerId}`, sk: 'AFFILIATE' } }))).Item;
  return item?.status === 'approved';
}

/**
 * Records who brought this new identity (write-once). `ref` comes from the
 * install referrer or a typed code; otherwise the website cookie is used.
 * Returns the attribution, or undefined if there is none / not allowed.
 */
export async function attribute(identityId: string, req: Req, ref: unknown, source: Attribution['source']): Promise<Attribution | undefined> {
  const cookie = req.cookies?.[REF_COOKIE];
  const code = parseRef(ref) ?? (source === 'web' ? parseRef(cookie) : undefined);
  if (!code) return undefined;
  const record = await lookupCode(code);
  if (!record || record.ownerId === identityId) return undefined;
  if (record.program === 'affiliate' && !(await affiliateActive(record.ownerId))) return undefined;
  const attribution: Attribution = { program: record.program, code: record.code, ownerId: record.ownerId, source, at: Date.now() };
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${identityId}`, sk: 'PROFILE' },
        UpdateExpression: 'SET attribution = :a',
        ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(attribution)',
        ExpressionAttributeValues: { ':a': attribution },
      }),
    );
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') return undefined; // already attributed
    throw error;
  }
  await bumpStats(record.code, { signups: 1 });
  await audit({ entity: `user:${identityId}`, action: 'attribution.set', actor: identityId, data: { ...attribution } });
  return attribution;
}

export function json302(location: string): Res {
  return json(200, { location });
}
