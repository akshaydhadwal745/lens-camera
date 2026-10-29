# Google Play Billing (Play Store app)

Status: design, 2026-10-29, branch `feat/play-billing`.

The Play Store build (`EXPO_PUBLIC_STORE=play`) can't use Razorpay: Play's policy requires Google Play
Billing for digital goods. The website and the website APK keep Razorpay (`razorpayHere`,
`src/lib/pay-channel.ts`). Both channels end in the same place: `PROFILE.plan` (`plans.ts`), so
storage, grace, lapse, reminders, the console and the affiliates work the same whoever took the money.

## Owner decisions (2026-10-29)

- **Same prices as the website:** Lens Plus ₹59 a month / ₹499 a year. Google keeps 15 %, so we
  net about ₹42.50 a month instead of ₹48.60 (prices include 18 % GST).
- **Lock-in:** left to Claude. Play can't start a subscription "on 20 Jan 2027", so the Play app has
  no ₹0 lock-in. Instead: an eligible-once **1-month free trial**, offered from the last 30 days of the
  welcome storage onwards. The trial ends about when the welcome ends, so it feels like the website
  lock-in, and costs almost nothing (the person already has 40 GB free that month).
- **Extras on Play:** to be planned now (below, "Extras"), owner to confirm.

## Products (Play Console → Monetize)

| Product id | Type | Base plan / price | What it gives |
|---|---|---|---|
| `lens_plus` | subscription | `monthly` ₹59 (auto-renew), `yearly` ₹499 (auto-renew); offer `welcome-trial` = 1 month free, new customers only | plan `plus50` (50 GB) |
| `lens_extra` | subscription | one base plan per size, price = GB × ₹3 a month: `gb4` ₹12, `gb5` ₹15 … `gb10` ₹30, `gb15` ₹45, `gb20` ₹60, `gb25` ₹75, `gb30` ₹90, `gb40` ₹120, `gb50` ₹150, `gb75` ₹225, `gb100` ₹300 | extra storage cap above Plus (needs active Plus) |
| `move_25gb` | one-time (consumable) | ₹375 | 25 GB of "Move to Google Drive" credit |
| `move_100gb` | one-time (consumable) | ₹1,500 | 100 GB of move credit |

## Extras (proposal)

**Extra storage (owner 2026-10-29: "one plan, then the user decides how much to add, 1 or 10 or
100 GB, and the cost is calculated").** The website meters use per day (₹3 per GB a month, up to the
chosen limit). Play has no metered or free-quantity subscriptions, so on Play the person **picks a
size and pays exactly GB × ₹3 a month**: one `lens_extra` subscription with a base plan per size
(4–10 GB in 1 GB steps, then 15, 20, 25, 30, 40, 50, 75, 100 GB; Play allows far more base plans if
needed). The app shows it as one picker with the live total. Smallest is 4 GB because Play has a
minimum subscription price (about ₹10); on the website any size from 1 GB works. Changing the size is
a Play plan change (prorated by Google). The pack is the quota (`PROFILE.extra.capGB`, same field the
website uses), with `extra.provider = 'play'` so the daily meter (`dailyExtra`) skips it: nothing to
bill, Google already charged. If Plus lapses, the pack's storage stops with it (as on the website) and
the app asks them to cancel the pack in Play (we can't cancel it for them; we can **revoke** it with a
refund via the API if they ask support).
- Money: ₹3 a GB nets ₹2.16 after GST and Google. Storage costs ₹0.8–2.5 a GB a month by age, and a
  prepaid pack is rarely full, so it pays its way. Website metering stays the better deal (bills only
  what is used); the Play app says so nowhere (Play rules forbid pointing to cheaper payment outside).

**Move to Google Drive above 10 GB.** Same price as the website, ₹15 a GB, sold as **packs of move
credit** (consumables): 25 GB ₹375, 100 GB ₹1,500. The credit goes to `PROFILE.moveCreditBytes`, the
same credit the Razorpay payment link fills, so `drive-move.ts` needs no change. The app offers the
smallest pack that covers what's left to move.
- Money: ₹15 nets ₹10.80 a GB; AWS charges ~₹9.60 a GB to send data out of Mumbai. Thin but positive,
  and the first 10 GB stay free for everyone.

**Download everything** stays free everywhere.

## Flow

1. App (Play build only) → `expo-iap` (Google Play Billing Library) → Google's purchase sheet.
   `obfuscatedAccountId` = SHA-256 of the Lens account id (Play rejects raw ids that look like PII);
   the server checks it matches the signed-in account.
2. App → `POST /v1/play/purchase { productId, purchaseToken }` (signed in).
3. Server → Play Developer API (`purchases.subscriptionsv2.get` / `purchases.products.get`) with a
   Google service account (`/lens/play/service-account`, SSM SecureString): checks package, product,
   account hash, state; then
   - `lens_plus` → `activatePlan(plus50, provider 'play', ref = purchaseToken, periodEnd = expiry)`;
   - `lens_extra` → `extra.capGB` from the base plan, `extra.provider = 'play'`;
   - `move_*` → `moveCreditBytes += pack`, then consume the purchase (so it can be bought again);
   - acknowledge the subscription (unacknowledged purchases are refunded by Google after 3 days).
   Idempotent: the purchase token is stored (`PLAYTOKEN#<sha256>`), a second call changes nothing.
4. **Real-time developer notifications** (renewal, grace, hold, cancel, expiry, refund): Play →
   Pub/Sub topic `play-rtdn` → push to `https://lens.instagrowapp.com/api/v1/play/rtdn` with a Google
   OIDC token (verified: issuer, audience, the push service account). The handler re-reads the
   subscription from Google (never trusts the message body) and maps it:

   | Google state | Lens |
   |---|---|
   | ACTIVE (bought / renewed / recovered) | `activatePlan` (new `periodEnd`) |
   | IN_GRACE_PERIOD, ON_HOLD | `paymentFailed` (our 7-day grace + reminders) |
   | auto-renew turned off (CANCELED, still in paid time) | `cancelPlan` (runs to period end) |
   | EXPIRED, REVOKED (refund), PAUSED | `lapsePlan` + `recordRefund` when revoked |
   | voided one-time purchase | remove the unused part of that move credit |

5. Restore: on app start (Play build) `getAvailablePurchases()` → re-posts anything the server hasn't
   seen (new phone, missed call).
6. Affiliates: `recordPurchase` / `recordRefund` exactly like Razorpay.
7. Maintenance (every 15 min): Play plans still get `advancePlans`; a daily pass re-reads every active
   Play subscription from Google as a safety net for lost notifications.

## App changes

- `src/lib/pay-channel.ts`: `playBillingHere` (Play build on Android).
- Plus screen, Extra storage card, Move-to-Drive sheet: Play price list from `expo-iap`
  (`fetchProducts`, localized prices from Google), buy buttons → Google sheet; manage/cancel →
  `https://play.google.com/store/account/subscriptions?sku=…&package=com.instagrowapp.lens`.
- No "cheaper on the website" text anywhere in the Play build.
- Native: `expo-iap` config plugin adds the billing permission; new native build (new runtime).

## Owner setup (one time, guided step by step)

1. Play Console → **Setup → Payments profile**: create the merchant profile (PAN, bank, GST).
2. **Monetize → Products**: create the products above (Claude can create them via the API once the
   service account exists, except the payments profile).
3. Google Cloud project `lens`: enable **Google Play Android Developer API** and **Pub/Sub**; service
   account `play-billing@…` (Claude via gcloud).
4. Play Console → **Users and permissions** → invite the service account: View app information, View
   financial data, Manage orders and subscriptions.
5. Pub/Sub topic `play-rtdn`, publisher = `google-play-developer-notifications@system.gserviceaccount.com`;
   push subscription to the API (Claude via gcloud). Play Console → **Monetize → Monetization setup**
   → topic name → "Send test notification".
6. **License testing**: add tester Gmails (test purchases, no real money; renewals every few minutes).

## Testing

- Unit: state mapping, idempotency, account-hash check, RTDN token check (`play-billing.test.ts`).
- e2e: fake Google responses behind a test switch, like the Razorpay e2e block.
- Real: closed-test build on the S8 with a license tester: buy monthly, renewals (5-minute test
  periods), cancel, restore, refund from Play Console, a move pack, an extra pack.

## Risks

- A purchase on a phone signed in to a different Lens account: the account hash check refuses it and
  the app explains; the person contacts support.
- People with both Razorpay and Play Plus: refuse to sell the second one (the app hides Play buy
  buttons when `plan.provider === 'razorpay'` is active, and the server rejects `razorpay` checkout
  while a Play plan is active).
