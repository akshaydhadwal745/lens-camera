# Feedback & reviews (in the app)

Settings → **Feedback**: *Rate Lens*, *Report a problem*, *Suggest a feature* (and *Other*) open `src/app/feedback.tsx`.

| Field | Rules |
|---|---|
| Category | `review`, `issue`, `idea`, `other` |
| Rating | 1–5 stars, required for a review, not asked otherwise |
| Message | up to 4,000 characters; optional for a review, at least 10 characters otherwise |
| Reply email | optional ("I'd like a reply by email"; pre-filled with the account email); used as Reply-To |
| Device details | only with the switch on (default on): brand, model, OS + version, APK/code build, locale. No photos, no location |

## The feedback loop (asking at good moments)
`src/lib/review-prompt.ts` (state on the phone) + `src/lib/review-prompt-rules.ts` (pure rules, `node scripts/test-review-prompt.mjs`, 11 cases) + `src/components/FeedbackPrompt.tsx` (card in the roll, never in the camera, never on web).

- **Who / when:** 5+ app opens over 3+ days, 10+ photos, and a calm moment (nothing uploading or failed, online, no sign-in banner). Decided 1.5 s after the roll opens.
- **First ask:** "How's Lens so far?" with 5 stars. Tapping a star opens the form with the rating filled in and a matching question: 4–5 → "Glad you like it! Anything you're missing?", 1–3 → "Sorry about that. What's missing or not working well?". Nothing is sent until **Send**.
- **Later asks:** "What's one thing Lens is missing?" → the Suggest-a-feature form.
- **Limits:** one card per 30 days, at most 3 per year, 120 days of quiet after any answer, **Don't ask again** is final, **Not now** (×) just closes it.
- Each submission carries `source`: `settings`, `prompt` (rating card) or `prompt-missing`; Admin → Feedback and the email show it.
- Later (on Google Play): 4–5 stars can also open the Play In-App Review sheet.

## Backend (`infra/lambda/api/feedback.ts`)
- `POST /v1/feedback` (any app identity, guest or signed in). Validation as above; honeypot field `website`; rate limits 10/hour per account and 40/hour per network.
- **Stored first** in DynamoDB (`pk FEEDBACK`, `sk <time>#<id>`, reference `F-XXXXXX`, 2-year TTL), **then emailed** to the team (`CONTACT_TO`, else admin emails) through SES with Reply-To = the user's email.
- If SES fails the row keeps `email_status: pending`; the Maintenance function re-sends pending emails **every hour** (EventBridge `FeedbackEmailRetry`, max 8 tries, last 7 days) and in the daily run. The feedback itself is never lost.
- Admin: `GET /v1/admin/feedback?status=new|done`, `POST /v1/admin/feedback/<id>/done`; app/web Admin → **Feedback** tab (ratings, average, device, Reply, Mark done).
- Deleting an account deletes its feedback. Privacy policy §1 lists it (EN + HI).

## Tests
`infra/scripts/e2e.sh` section "in-app feedback": stored review, rating/length/email validation, honeypot, device consent (no device kept when off; unknown fields dropped), admin list + done, hidden from normal accounts, removed by account deletion.
