// OAuth relay for connecting Google Drive, Dropbox, OneDrive and Box.
//
// Each provider is registered once as a "web app" whose redirect URI is this
// API's /v1/oauth/callback. The flow:
//   1. App → POST /oauth/:provider/start {codeChallenge}: signed `state` +
//      the provider's sign-in URL.
//   2. User signs in → provider → GET /oauth/callback?code&state → 302 to
//      lens://oauth?... (the app's in-app browser session catches it).
//   3. App → POST /oauth/:provider/token {code, state, codeVerifier}: we add
//      the client secret, exchange, and return the tokens. Nothing is stored.
//   4. App → POST /oauth/:provider/refresh {refreshToken} when tokens expire.
// A code is useless without both the PKCE verifier (kept by the app) and the
// client secret (kept here), and `state` binds it to the Lens identity.
//
// Credentials live in SSM: /lens/oauth/{provider}/client-id and /client-secret
// (see infra/scripts/set-oauth-client.sh). Unconfigured providers return 503.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Identity } from './identity';
import { derivedKey, env, getParam, HttpError, json, Req, Res } from './lib';

/** Storage providers + 'google' = Sign in with Google (same Google client as Drive). */
type OAuthProvider = 'gdrive' | 'dropbox' | 'onedrive' | 'box' | 'google';

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  scope?: string;
  extra?: Record<string, string>;
  pkce: boolean;
};

const CONFIG: Record<OAuthProvider, ProviderConfig> = {
  gdrive: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // drive.file: only files Lens creates (no Google security assessment needed).
    scope: 'https://www.googleapis.com/auth/drive.file openid email',
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    pkce: true,
  },
  dropbox: {
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    extra: { token_access_type: 'offline' }, // scopes come from the app's App-folder permissions
    pkce: true,
  },
  onedrive: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'Files.ReadWrite.AppFolder User.Read offline_access',
    extra: { prompt: 'select_account' },
    pkce: true,
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    extra: { prompt: 'select_account' },
    pkce: true,
  },
  box: {
    authorizeUrl: 'https://account.box.com/api/oauth2/authorize',
    tokenUrl: 'https://api.box.com/oauth2/token',
    pkce: false, // Box relies on the client secret + state binding
  },
};

const STATE_TTL_MS = 10 * 60 * 1000;
const APP_REDIRECT = 'lens://oauth';
const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;

function provider(value: string): OAuthProvider {
  if (!(value in CONFIG)) throw new HttpError(400, 'Unknown provider');
  return value as OAuthProvider;
}

async function credentials(p: OAuthProvider) {
  const stored = p === 'google' ? 'gdrive' : p; // one Google web client for Drive and sign-in
  const [clientId, clientSecret] = await Promise.all([
    getParam(`/lens/oauth/${stored}/client-id`),
    getParam(`/lens/oauth/${stored}/client-secret`),
  ]);
  if (!clientId || !clientSecret) throw new HttpError(503, 'This storage isn’t available yet');
  return { clientId, clientSecret };
}

/** This API's public callback URL (the Function URL host the request came in on). */
function callbackUrl(req: Req): string {
  const host = req.headers.host ?? req.headers.Host;
  if (!host) throw new HttpError(500, 'Missing host');
  return `https://${host}/v1/oauth/callback`;
}

// ---------- state: base64url(json).base64url(hmac) ----------

/** `i`: the Lens identity, or "web" for a website sign-in (no identity yet). */
type State = { p: OAuthProvider; i: string; e: number; n: string };

const WEB = 'web';

async function signState(state: State): Promise<string> {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  const mac = createHmac('sha256', await derivedKey('oauth-state')).update(body).digest('base64url');
  return `${body}.${mac}`;
}

async function readState(value: unknown): Promise<State> {
  if (typeof value !== 'string' || value.length > 1000) throw new HttpError(400, 'Invalid state');
  const [body, mac] = value.split('.');
  const expected = createHmac('sha256', await derivedKey('oauth-state')).update(body ?? '').digest();
  const given = Buffer.from(mac ?? '', 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(400, 'Invalid state');
  const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as State;
  if (state.e < Date.now()) throw new HttpError(400, 'Sign-in took too long. Please try again.');
  return state;
}

// ---------- endpoints ----------

/**
 * POST /v1/web/auth/google/start {codeChallenge}: Google sign-in URL for the
 * website. Comes back through the same callback, which then returns to the
 * website's /signin page instead of the app.
 */
export async function webStartGoogle(req: Req): Promise<Res> {
  if (!env.webOrigin) throw new HttpError(503, 'Website sign-in isn’t set up');
  const challenge = req.body.codeChallenge;
  if (typeof challenge !== 'string' || !CHALLENGE.test(challenge)) throw new HttpError(400, 'Invalid code challenge');
  const { clientId } = await credentials('google');
  const config = CONFIG.google;
  const state = await signState({ p: 'google', i: WEB, e: Date.now() + STATE_TTL_MS, n: randomBytes(8).toString('hex') });
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (config.scope) url.searchParams.set('scope', config.scope);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(config.extra ?? {})) url.searchParams.set(k, v);
  return json(200, { url: url.toString(), state });
}

/** POST /v1/oauth/:provider/start {codeChallenge}: sign-in URL for the in-app browser. */
export async function startOAuth(identity: Identity, providerName: string, req: Req): Promise<Res> {
  const p = provider(providerName);
  const config = CONFIG[p];
  const { clientId } = await credentials(p);
  const challenge = req.body.codeChallenge;
  if (config.pkce && (typeof challenge !== 'string' || !CHALLENGE.test(challenge))) throw new HttpError(400, 'Invalid code challenge');

  const state = await signState({ p, i: identity.id, e: Date.now() + STATE_TTL_MS, n: randomBytes(8).toString('hex') });
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (config.scope) url.searchParams.set('scope', config.scope);
  if (config.pkce) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(config.extra ?? {})) url.searchParams.set(k, v);
  return json(200, { url: url.toString(), state, redirect: APP_REDIRECT });
}

/** GET /v1/oauth/callback: provider → here → back into the app, or the website (public). */
export async function oauthCallback(req: Req): Promise<Res> {
  const { code, state, error, error_description } = req.query;
  const params = new URLSearchParams();
  let web = false;
  if (error) {
    params.set('error', String(error_description ?? error).slice(0, 200));
  } else {
    try {
      const s = await readState(state);
      web = s.i === WEB;
      params.set('provider', s.p);
      params.set('code', String(code ?? ''));
      params.set('state', String(state));
    } catch (e) {
      params.set('error', e instanceof HttpError ? e.message : 'Sign-in failed');
    }
  }
  // Website: the code goes in the fragment (never sent to servers or logged).
  const location = web && env.webOrigin ? `${env.webOrigin}/signin/#${params}` : `${APP_REDIRECT}?${params}`;
  return {
    statusCode: 302,
    headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    body: '',
  };
}

async function tokenRequest(p: OAuthProvider, params: Record<string, string>) {
  const { clientId, clientSecret } = await credentials(p);
  const res = await fetch(CONFIG[p].tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    // invalid_grant = the user revoked access or the refresh token expired: sign in again.
    const signedOut = data.error === 'invalid_grant';
    return json(signedOut ? 401 : 502, {
      error: signedOut ? 'Signed out of this storage. Please sign in again.' : 'The storage provider refused the sign-in',
      code: signedOut ? 'signed-out' : 'provider-error',
    });
  }
  return json(200, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // may be absent on refresh: keep the old one
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in ?? 3600) - 60) * 1000,
    // Dropbox and Box include the account id; Google/Microsoft put it in the id token / profile call.
    accountId: data.account_id ?? data.user_id,
  });
}

/** POST /v1/oauth/:provider/token {code, state, codeVerifier}. */
export async function exchangeOAuth(identity: Identity, providerName: string, req: Req): Promise<Res> {
  const p = provider(providerName);
  const state = await readState(req.body.state);
  if (state.p !== p || state.i !== identity.id) throw new HttpError(403, 'This sign-in belongs to someone else');
  if (typeof req.body.code !== 'string' || !req.body.code) throw new HttpError(400, 'Missing code');
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code: req.body.code,
    redirect_uri: callbackUrl(req),
  };
  if (CONFIG[p].pkce) {
    if (typeof req.body.codeVerifier !== 'string') throw new HttpError(400, 'Missing code verifier');
    params.code_verifier = req.body.codeVerifier;
  }
  return tokenRequest(p, params);
}

/** POST /v1/oauth/:provider/refresh {refreshToken}. */
export async function refreshOAuth(_identity: Identity, providerName: string, req: Req): Promise<Res> {
  const p = provider(providerName);
  if (typeof req.body.refreshToken !== 'string' || !req.body.refreshToken) throw new HttpError(400, 'Missing refresh token');
  return tokenRequest(p, { grant_type: 'refresh_token', refresh_token: req.body.refreshToken });
}

/** GET /v1/oauth/providers: which providers are set up (so the app can show Connect). */
export async function oauthProviders(): Promise<Res> {
  const ready = await Promise.all(
    (Object.keys(CONFIG) as OAuthProvider[]).map(
      async (p) => [p, !!(await getParam(`/lens/oauth/${p === 'google' ? 'gdrive' : p}/client-id`))] as const,
    ),
  );
  return json(200, { providers: Object.fromEntries(ready) });
}

/**
 * Sign in with Google: exchanges the code (PKCE + client secret) and reads the
 * ID token. It comes straight from Google's token endpoint over TLS, so per
 * OpenID Connect the signature check can be skipped; we still check issuer,
 * audience and expiry.
 */
/** `identity` null = the website (state must have been made for the web). */
export async function googleLoginClaims(identity: Identity | null, req: Req) {
  const state = await readState(req.body.state);
  if (state.p !== 'google' || state.i !== (identity ? identity.id : WEB)) throw new HttpError(403, 'This sign-in belongs to someone else');
  if (typeof req.body.code !== 'string' || typeof req.body.codeVerifier !== 'string') throw new HttpError(400, 'Missing code');
  const { clientId, clientSecret } = await credentials('google');
  const res = await fetch(CONFIG.google.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: req.body.code,
      code_verifier: req.body.codeVerifier,
      redirect_uri: callbackUrl(req),
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: string };
  if (!res.ok || !data.id_token) throw new HttpError(401, 'Google sign-in failed. Please try again.');
  const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8')) as Record<string, any>;
  const validIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!validIssuer || claims.aud !== clientId || Number(claims.exp) * 1000 < Date.now() || !claims.sub) {
    throw new HttpError(401, 'Google sign-in could not be verified');
  }
  return { sub: String(claims.sub), email: claims.email as string | undefined, emailVerified: claims.email_verified === true };
}
