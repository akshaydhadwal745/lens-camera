// Google Play Billing in the Play Store build (docs/design/play-billing.md). Google shows its own
// payment sheet; our server checks every purchase with Google before anything turns on
// (POST /v1/play/purchase, infra/lambda/api/play-billing.ts) and acknowledges/consumes it.
// The website and the website APK use Razorpay instead (pay-channel.ts), so expo-iap is only loaded
// in the Play build.
import { api, PlayStatus } from '@/lib/api';
import { playBillingHere } from '@/lib/pay-channel';

type Iap = typeof import('expo-iap');
type Purchase = import('expo-iap').Purchase;
type SubOffer = { basePlanIdAndroid?: string | null; id: string; offerTokenAndroid?: string | null; displayPrice: string; price: number; paymentMode?: string | null };

export const PLUS_PRODUCT = 'lens_plus';
export const EXTRA_PRODUCTS = ['lens_extra_a', 'lens_extra_b'] as const;
export const MOVE_PACKS: Record<string, number> = { move_25gb: 25, move_100gb: 100 };

let iap: Iap | undefined;
let connected: Promise<unknown> | undefined;
let pending: { productId: string; resolve: (p: Purchase) => void; reject: (e: Error) => void } | undefined;

function lib(): Iap {
  if (!playBillingHere) throw new Error('Google Play payments are only in the Lens app from Google Play.');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  iap ??= require('expo-iap') as Iap;
  return iap;
}

/** Connects once and listens for purchases (the result of requestPurchase arrives here). */
async function ready(): Promise<Iap> {
  const m = lib();
  connected ??= m.initConnection().then(() => {
    m.purchaseUpdatedListener((p) => {
      if (pending && p.productId === pending.productId) {
        pending.resolve(p);
        pending = undefined;
      } else void settle(p).catch(() => {}); // a purchase finishing late (pending payment, other screen)
    });
    m.purchaseErrorListener((e) => {
      if (!pending) return;
      pending.reject(Object.assign(new Error(m.isUserCancelledError(e) ? 'cancelled' : e.message || 'Google Play couldn’t finish the payment.'), { cancelled: m.isUserCancelledError(e) }));
      pending = undefined;
    });
  });
  try {
    await connected;
  } catch (e) {
    connected = undefined;
    throw e;
  }
  return m;
}

/** Our server checks the purchase with Google and turns it on; then Google's queue is cleared. */
async function settle(p: Purchase) {
  if (!p.purchaseToken || p.purchaseState !== 'purchased') return;
  await api.playPurchase(p.productId, p.purchaseToken);
  // The server already acknowledged / consumed it; this only clears the purchase on the phone.
  await lib()
    .finishTransaction({ purchase: p, isConsumable: p.productId in MOVE_PACKS })
    .catch(() => {});
}

export type PlusPrice = { basePlan: 'monthly' | 'yearly'; offerToken: string; price: string; trial: boolean };
export type ExtraPrice = { gb: number; productId: string; offerToken: string; price: string };

/** Google's prices for Lens Plus (in the phone's currency), the free month when we offer it. */
export async function plusPrices(trialOffer?: string): Promise<PlusPrice[]> {
  const m = await ready();
  const [product] = (await m.fetchProducts({ skus: [PLUS_PRODUCT], type: 'subs' })) as { subscriptionOffers?: SubOffer[] | null }[];
  const offers = product?.subscriptionOffers ?? [];
  const out: PlusPrice[] = [];
  for (const basePlan of ['monthly', 'yearly'] as const) {
    const base = offers.find((o) => o.basePlanIdAndroid === basePlan && o.id === basePlan);
    const trial = trialOffer ? offers.find((o) => o.basePlanIdAndroid === basePlan && o.id === trialOffer) : undefined;
    const chosen = trial ?? base ?? offers.find((o) => o.basePlanIdAndroid === basePlan);
    if (chosen?.offerTokenAndroid) out.push({ basePlan, offerToken: chosen.offerTokenAndroid, price: (base ?? chosen).displayPrice, trial: !!trial });
  }
  return out;
}

/** Every extra-storage size Google sells (one base plan per GB, gb4…gb100). */
export async function extraPrices(): Promise<ExtraPrice[]> {
  const m = await ready();
  const products = (await m.fetchProducts({ skus: [...EXTRA_PRODUCTS], type: 'subs' })) as { id: string; subscriptionOffers?: SubOffer[] | null }[];
  const out: ExtraPrice[] = [];
  for (const p of products)
    for (const o of p.subscriptionOffers ?? []) {
      const gb = Number(/^gb(\d+)$/.exec(o.basePlanIdAndroid ?? '')?.[1]);
      if (gb && o.offerTokenAndroid && o.id === o.basePlanIdAndroid) out.push({ gb, productId: p.id, offerToken: o.offerTokenAndroid, price: o.displayPrice });
    }
  return out.sort((a, b) => a.gb - b.gb);
}

async function buy(productId: string, request: Parameters<Iap['requestPurchase']>[0]): Promise<void> {
  const m = await ready();
  if (pending) throw new Error('Another payment is still open.');
  const done = new Promise<Purchase>((resolve, reject) => (pending = { productId, resolve, reject }));
  try {
    await m.requestPurchase(request);
  } catch (e) {
    pending = undefined;
    throw e;
  }
  const p = await done;
  if (p.purchaseState === 'pending') throw new Error('Your payment is pending. Lens turns it on as soon as Google confirms it.');
  await settle(p);
}

/** Lens Plus through Google Play (monthly or yearly; the free month if `price.trial`). */
export async function buyPlus(price: PlusPrice, status: PlayStatus) {
  await buy(PLUS_PRODUCT, {
    type: 'subs',
    request: { google: { skus: [PLUS_PRODUCT], subscriptionOffers: [{ sku: PLUS_PRODUCT, offerToken: price.offerToken }], obfuscatedAccountId: status.accountHash } },
  });
}

/** Extra storage: a new size, or a change from the current one (Google prorates the difference). */
export async function buyExtra(price: ExtraPrice, status: PlayStatus) {
  const current = status.tokens?.extra;
  const currentProduct = current ? (await currentExtraProduct()) : undefined;
  await buy(price.productId, {
    type: 'subs',
    request: {
      google: {
        skus: [price.productId],
        subscriptionOffers: [{ sku: price.productId, offerToken: price.offerToken }],
        obfuscatedAccountId: status.accountHash,
        ...(current && currentProduct
          ? { purchaseToken: current, subscriptionProductReplacementParams: { oldProductId: currentProduct, replacementMode: 'with-time-proration' as const } }
          : {}),
      },
    },
  });
}

async function currentExtraProduct(): Promise<string | undefined> {
  const m = await ready();
  const subs = await m.getAvailablePurchases();
  return subs.find((p) => (EXTRA_PRODUCTS as readonly string[]).includes(p.productId))?.productId;
}

/**
 * "Move to Google Drive" credit for `gb`: every pack is ₹15 a GB, so the cheapest is the fewest 25 GB
 * steps that cover it, with each four of them as one 100 GB pack (fewer payments).
 */
export function packsFor(gb: number): string[] {
  const steps = Math.ceil(Math.max(0, gb) / 25);
  return [...Array<string>(Math.floor(steps / 4)).fill('move_100gb'), ...Array<string>(steps % 4).fill('move_25gb')];
}

export async function movePackPrices(): Promise<Record<string, string>> {
  const m = await ready();
  const products = (await m.fetchProducts({ skus: Object.keys(MOVE_PACKS), type: 'in-app' })) as { id: string; displayPrice: string }[];
  return Object.fromEntries(products.map((p) => [p.id, p.displayPrice]));
}

export async function buyMovePack(productId: string, status: PlayStatus) {
  await buy(productId, { type: 'in-app', request: { google: { skus: [productId], obfuscatedAccountId: status.accountHash } } });
}

/** App start (Play build): anything bought but never confirmed with our server (crash, no network). */
export async function restorePlayPurchases() {
  if (!playBillingHere) return;
  try {
    const m = await ready();
    for (const p of await m.getAvailablePurchases()) await settle(p).catch(() => {});
  } catch {
    // no Play services / signed out of Play: nothing to restore
  }
}

/** Google Play's own page to change payment or cancel. */
export const manageUrl = (productId = PLUS_PRODUCT) => `https://play.google.com/store/account/subscriptions?sku=${productId}&package=com.instagrowapp.lens`;
