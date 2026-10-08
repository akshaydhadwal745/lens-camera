import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
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
  quotaBytes: Number(process.env.QUOTA_BYTES),
  maxFileBytes: Number(process.env.MAX_FILE_BYTES),
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
  return {
    method: event.requestContext.http.method,
    path: event.rawPath.replace(/\/+$/, '') || '/',
    query: event.queryStringParameters ?? {},
    body: body ?? {},
    headers: event.headers ?? {},
  };
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
