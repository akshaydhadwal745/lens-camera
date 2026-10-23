// Razorpay REST client (docs/business/payments.md). Keys live in SSM:
//   /lens/razorpay/key-id, /key-secret      API keys (test keys until the owner switches to live)
//   /lens/razorpay/plans                    {"plus50-month": "plan_…", "plus50-year": "plan_…"}
//   /lens/razorpay/webhook-secret           the secret set on the dashboard webhook
// Card/UPI details never touch Lens: people pay on Razorpay's own hosted pages (short_url).
import { createHmac } from 'node:crypto';

import { getParam, HttpError, safeEqual } from './lib';

const API = 'https://api.razorpay.com/v1';

export async function razorpayConfigured(): Promise<boolean> {
  return !!(await getParam('/lens/razorpay/key-id')) && !!(await getParam('/lens/razorpay/key-secret'));
}

/** Test keys start with rzp_test_ (the app shows "Test mode" so nobody thinks it's real money). */
export async function testMode(): Promise<boolean> {
  return ((await getParam('/lens/razorpay/key-id')) ?? '').startsWith('rzp_test_');
}

export async function rzp<T = any>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const id = await getParam('/lens/razorpay/key-id');
  const secret = await getParam('/lens/razorpay/key-secret');
  if (!id || !secret) throw new HttpError(503, 'Payments aren’t available yet', 'payments-off');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    console.error('razorpay', method, path, res.status, JSON.stringify(data?.error ?? data).slice(0, 300));
    throw new HttpError(502, 'The payment service didn’t answer. Try again in a minute.', 'payments-error');
  }
  return data as T;
}

export async function planIds(): Promise<Record<string, string>> {
  const raw = await getParam('/lens/razorpay/plans');
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

/** Webhook: HMAC-SHA256 of the exact body with the dashboard webhook secret. */
export async function verifyWebhook(rawBody: string | undefined, signature: string | undefined): Promise<boolean> {
  const secret = await getParam('/lens/razorpay/webhook-secret');
  if (!secret || !rawBody || !signature) return false;
  return safeEqual(createHmac('sha256', secret).update(rawBody).digest('hex'), signature);
}

export type RzpSubscription = {
  id: string;
  plan_id: string;
  status: 'created' | 'authenticated' | 'active' | 'pending' | 'halted' | 'cancelled' | 'completed' | 'expired' | 'paused';
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  start_at?: number | null;
  paid_count: number;
  short_url?: string;
  notes?: Record<string, string>;
};

export type RzpInvoice = { id: string; status: string; payment_id?: string | null; amount_paid?: number; amount?: number; paid_at?: number | null };
