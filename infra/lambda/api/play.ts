// Google Play Developer API client for Play Billing (docs/design/play-billing.md). Settings in SSM:
//   /lens/play/service-account   the service account's JSON key (SecureString), invited in Play Console
//                                with "View financial data" + "Manage orders and subscriptions"
//   /lens/play/rtdn-audience     the audience set on the Pub/Sub push subscription
//   /lens/play/push-account      the service account email Pub/Sub signs push requests with
// No Google SDK: a signed JWT for the access token and plain fetch keep the Lambda small.
import { createPublicKey, createSign, createVerify } from 'node:crypto';

import { getParam, HttpError } from './lib';

export const PACKAGE = 'com.instagrowapp.lens';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

let cached: { token: string; until: number } | undefined;

export async function playConfigured(): Promise<boolean> {
  return !!(await getParam('/lens/play/service-account'));
}

/** OAuth access token for the service account (JWT bearer grant), cached until 5 minutes before expiry. */
async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const raw = await getParam('/lens/play/service-account');
  if (!raw) throw new HttpError(503, 'Google Play payments aren’t set up yet', 'payments-off');
  const key = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const now = Math.floor(Date.now() / 1000);
  const aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key);
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    console.error('play token', res.status, data.error);
    throw new HttpError(502, 'Google Play didn’t answer. Try again in a minute.', 'payments-error');
  }
  cached = { token: data.access_token, until: Date.now() + ((data.expires_in ?? 3600) - 300) * 1000 };
  return data.access_token;
}

/** Calls the Play Developer API. A 404/410 (unknown or expired token) comes back as `undefined`. */
export async function play<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T | undefined> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404 || res.status === 410) return undefined;
  const text = await res.text();
  if (!res.ok) {
    console.error('play', method, path.replace(/tokens\/[^/:]+/, 'tokens/…'), res.status, text.slice(0, 300));
    throw new HttpError(502, 'Google Play didn’t answer. Try again in a minute.', 'payments-error');
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------- types (Play Developer API v3) ----------

export type SubscriptionState =
  | 'SUBSCRIPTION_STATE_UNSPECIFIED'
  | 'SUBSCRIPTION_STATE_PENDING'
  | 'SUBSCRIPTION_STATE_ACTIVE'
  | 'SUBSCRIPTION_STATE_PAUSED'
  | 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
  | 'SUBSCRIPTION_STATE_ON_HOLD'
  | 'SUBSCRIPTION_STATE_CANCELED'
  | 'SUBSCRIPTION_STATE_EXPIRED'
  | 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED';

type Money = { currencyCode?: string; units?: string; nanos?: number };

export type SubscriptionPurchaseV2 = {
  subscriptionState: SubscriptionState;
  acknowledgementState?: 'ACKNOWLEDGEMENT_STATE_PENDING' | 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  testPurchase?: object;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: {
    productId: string;
    expiryTime?: string;
    offerDetails?: { basePlanId?: string; offerId?: string };
    autoRenewingPlan?: { autoRenewEnabled?: boolean; recurringPrice?: Money };
    offerPhase?: { freeTrial?: object; introductoryPrice?: object; basePrice?: object; prorationPeriod?: object };
    latestSuccessfulOrderId?: string;
  }[];
};

export type ProductPurchase = {
  purchaseState?: number; // 0 purchased, 1 cancelled, 2 pending
  consumptionState?: number; // 0 not yet consumed, 1 consumed
  acknowledgementState?: number;
  orderId?: string;
  obfuscatedExternalAccountId?: string;
  quantity?: number;
  purchaseTimeMillis?: string;
};

export const moneyPaise = (m?: Money) => (m?.units || m?.nanos ? Math.round(Number(m.units ?? 0) * 100 + (m.nanos ?? 0) / 1e7) : undefined);

// ---------- real-time developer notifications (Pub/Sub push) ----------

type GoogleKey = { kid: string; kty: string; n: string; e: string; alg?: string; use?: string };
let certs: { keys: GoogleKey[]; until: number } | undefined;

async function googleKeys() {
  if (certs && certs.until > Date.now()) return certs.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10_000) });
  const data = (await res.json()) as { keys: GoogleKey[] };
  certs = { keys: data.keys, until: Date.now() + 3_600_000 };
  return data.keys;
}

/**
 * Pub/Sub push requests carry a Google-signed OIDC token: checks signature, issuer, expiry, audience
 * and that it was signed for our push service account. Without it anyone could post fake renewals
 * (the handler re-reads Google anyway, but this keeps strangers out).
 */
export async function verifyPushToken(authorization: string | undefined): Promise<boolean> {
  const token = authorization?.replace(/^Bearer /i, '');
  if (!token) return false;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return false;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg?: string; kid?: string };
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean };
    if (header.alg !== 'RS256') return false;
    const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(createPublicKey({ key: jwk as never, format: 'jwk' }), Buffer.from(s, 'base64url'));
    if (!ok) return false;
    const audience = await getParam('/lens/play/rtdn-audience');
    const account = await getParam('/lens/play/push-account');
    return (
      (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com') &&
      (claims.exp ?? 0) * 1000 > Date.now() &&
      !!audience &&
      claims.aud === audience &&
      !!account &&
      claims.email === account &&
      claims.email_verified === true
    );
  } catch {
    return false;
  }
}
