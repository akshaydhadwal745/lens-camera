// Over-the-air app updates (Expo Updates protocol v1), self-hosted.
//
// CI publishes each JS update to the website bucket: content-addressed files
// under /ota/a/ and, per platform + runtime version, one signed manifest at
// /ota/m/<platform>/<runtime>.json = { manifest: "<json string>", signature }.
// The manifest is signed in CI with our private key; the app only accepts
// updates whose signature matches the certificate built into it. This route
// just finds the latest manifest for the asking app and answers in the
// protocol's multipart format. Runtime versions are fingerprints of the native
// code, so an app never gets JS that needs native code it doesn't have.
import { env, HttpError, Req, Res } from './lib';

type Stored = { manifest: string; signature: string };

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; value: Stored | null }>();

async function latest(platform: string, runtime: string): Promise<Stored | null> {
  const key = `${platform}/${runtime}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const res = await fetch(`${env.webOrigin}/ota/m/${platform}/${encodeURIComponent(runtime)}.json`, { cache: 'no-store' });
  let value: Stored | null = null;
  if (res.ok) {
    const body = (await res.json()) as Partial<Stored>;
    if (typeof body.manifest === 'string' && typeof body.signature === 'string') value = body as Stored;
  } else if (res.status !== 404 && res.status !== 403) {
    throw new HttpError(502, 'Update store unavailable');
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

const PROTOCOL_HEADERS = {
  'expo-protocol-version': '1',
  'expo-sfv-version': '0',
  'cache-control': 'private, max-age=0',
};

export async function updateManifest(req: Req): Promise<Res> {
  const platform = req.headers['expo-platform'];
  const runtime = req.headers['expo-runtime-version'];
  if (platform !== 'android' && platform !== 'ios') throw new HttpError(400, 'Unsupported platform');
  if (!runtime || !/^[A-Za-z0-9._-]{1,128}$/.test(runtime)) throw new HttpError(400, 'Missing runtime version');
  if ((req.headers['expo-protocol-version'] ?? '1') !== '1') return { statusCode: 406, headers: PROTOCOL_HEADERS, body: '' };

  const stored = await latest(platform, runtime);
  // Nothing published for this app build yet: it keeps running what it has.
  if (!stored) return { statusCode: 204, headers: PROTOCOL_HEADERS, body: '' };

  const boundary = `lens-${Date.now().toString(36)}`;
  const body = [
    `--${boundary}`,
    'content-disposition: form-data; name="manifest"',
    'content-type: application/json; charset=utf-8',
    `expo-signature: ${stored.signature}`,
    '',
    stored.manifest,
    `--${boundary}`,
    'content-disposition: form-data; name="extensions"',
    'content-type: application/json',
    '',
    JSON.stringify({ assetRequestHeaders: {} }),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return {
    statusCode: 200,
    headers: { ...PROTOCOL_HEADERS, 'content-type': `multipart/mixed; boundary=${boundary}` },
    body,
  };
}
