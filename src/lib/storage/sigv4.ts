// AWS Signature Version 4 for S3-compatible storages (Backblaze B2, Wasabi,
// Cloudflare R2, MinIO, AWS S3…). Pure: the SHA-256 function is passed in
// (native expo-crypto in the app, node:crypto in tests).

export type Creds = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
export type Sha256 = (data: Uint8Array) => Promise<Uint8Array>;

const enc = new TextEncoder();

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

async function hmac(sha256: Sha256, key: Uint8Array, message: string): Promise<Uint8Array> {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? await sha256(key) : key);
  const inner = block.map((b) => b ^ 0x36);
  const outer = block.map((b) => b ^ 0x5c);
  return sha256(concat(outer, await sha256(concat(inner, enc.encode(message)))));
}

/** RFC 3986 encoding, as SigV4 wants (encodeURIComponent leaves !'()* alone). */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(url: URL): string {
  return url.pathname
    .split('/')
    .map((segment) => uriEncode(decodeURIComponent(segment)))
    .join('/');
}

function canonicalQuery(params: [string, string][]): string {
  return params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function stamp(now: Date) {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261008T143005Z
  return { amzDate: iso, date: iso.slice(0, 8) };
}

async function signingKey(sha256: Sha256, secret: string, date: string, region: string): Promise<Uint8Array> {
  const kDate = await hmac(sha256, enc.encode(`AWS4${secret}`), date);
  const kRegion = await hmac(sha256, kDate, region);
  const kService = await hmac(sha256, kRegion, 's3');
  return hmac(sha256, kService, 'aws4_request');
}

/**
 * Headers to send for a request (adds Authorization, x-amz-date,
 * x-amz-content-sha256, x-amz-security-token). `headers` must contain every
 * header that will be sent besides Host (Host is signed from the URL).
 */
export async function signRequest(
  sha256: Sha256,
  creds: Creds,
  region: string,
  method: string,
  url: URL,
  headers: Record<string, string> = {},
  payloadHash = 'UNSIGNED-PAYLOAD',
  now = new Date(),
): Promise<Record<string, string>> {
  const { amzDate, date } = stamp(now);
  const all: Record<string, string> = {
    ...headers,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...(creds.sessionToken ? { 'x-amz-security-token': creds.sessionToken } : {}),
  };
  const signed: Record<string, string> = { host: url.host };
  for (const [k, v] of Object.entries(all)) signed[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const names = Object.keys(signed).sort();
  const canonical = [
    method,
    canonicalPath(url),
    canonicalQuery([...url.searchParams.entries()]),
    names.map((n) => `${n}:${signed[n]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(await sha256(enc.encode(canonical)))].join('\n');
  const signature = hex(await hmac(sha256, await signingKey(sha256, creds.secretAccessKey, date, region), toSign));
  return {
    ...all,
    Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

/** A presigned URL (query-string auth), e.g. a GET valid for `expires` seconds. */
export async function presignUrl(
  sha256: Sha256,
  creds: Creds,
  region: string,
  method: string,
  url: URL,
  expires = 3600,
  now = new Date(),
): Promise<string> {
  const { amzDate, date } = stamp(now);
  const scope = `${date}/${region}/s3/aws4_request`;
  const out = new URL(url.toString());
  out.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  out.searchParams.set('X-Amz-Credential', `${creds.accessKeyId}/${scope}`);
  out.searchParams.set('X-Amz-Date', amzDate);
  out.searchParams.set('X-Amz-Expires', String(expires));
  if (creds.sessionToken) out.searchParams.set('X-Amz-Security-Token', creds.sessionToken);
  out.searchParams.set('X-Amz-SignedHeaders', 'host');
  const canonical = [
    method,
    canonicalPath(out),
    canonicalQuery([...out.searchParams.entries()]),
    `host:${out.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(await sha256(enc.encode(canonical)))].join('\n');
  const signature = hex(await hmac(sha256, await signingKey(sha256, creds.secretAccessKey, date, region), toSign));
  // Rebuild the query with SigV4 encoding (URLSearchParams uses + for spaces).
  const query = canonicalQuery([...out.searchParams.entries()]);
  return `${out.origin}${canonicalPath(out)}?${query}&X-Amz-Signature=${signature}`;
}
