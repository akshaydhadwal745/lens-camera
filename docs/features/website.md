# Website and web app (lens.instagrowapp.com)

**Live now at:** https://d13kuzzim5hg3c.cloudfront.net (until the domain is
connected; see "Domain" below). **Design:** [design/website.md](../design/website.md).

## What's where

| Path | What | Indexed by Google |
|---|---|---|
| `/` and `/hi/` | Home (English / Hindi) | Yes |
| `/features/…`, `/use-cases/…` | 9 feature + 3 use-case pages, each in English and Hindi | Yes |
| `/pricing/`, `/security/`, `/help/`, `/download/` | Info pages | Yes |
| `/privacy/`, `/terms/`, `/delete-account/` | Legal (Google Play needs all three) | Yes |
| `/signin/` | Sign in: QR from the phone, email code, or Google | No |
| `/l/<id>/` | Where the sign-in QR points (opens the app) | No |
| `/app/` | The web app (signed-in area) | No |
| `/api/` | The API, same domain (for the session cookie) | No |

**Code:** `site/` (Astro, static HTML), the web app is the Expo app exported
under `/app` (`app.json` → `experiments.baseUrl`), built together by
`scripts/build-web.sh`.

## Signing in on the web

1. **QR (recommended):** the sign-in page shows a QR that refreshes itself. On
   the phone: **Settings → Computers → Link a computer** and scan, or point the
   phone camera at it (Android opens Lens via an App Link). The phone shows the
   browser and approximate city and asks **Approve / Deny**.
2. **Email code** or **Google**: the same account as the app. First-time web
   users get a new account (100 GB).

The browser session is an **HttpOnly, Secure, SameSite=Strict `__Host-lens`
cookie** (30 days): page scripts can't read it, other sites can't send it, and
changes also need a header other sites can't add. The phone lists signed-in
browsers (Settings → Computers) and can log them all out; the web app has
Settings → Sign out of this browser.

## The web app

- Gallery and viewer at full quality, zoom, Shared tab, Trash/Archive, storage, account.
- **Upload from the computer:** Upload button or drag & drop anywhere. Original
  bytes, every part MD5-checked by S3, thumbnail + preview made in the browser
  and uploaded first, the photo's real date read from EXIF. JPEG, PNG, WebP,
  AVIF, HEIC/HEIF, DNG, MP4, MOV. (HEIC/RAW get no preview when the browser
  can't decode them; phones show them normally.)
- **Automatic sync:** changes from phones appear without reloading (every
  30 s while the tab is visible, and right away when you come back to it).
- **Delete account** (also in the phone app, Settings → Delete account):
  removes everything; see `/delete-account/`.

## SEO and performance

- Static HTML, ~7 KB gzipped home page, no JavaScript except on sign-in.
- Lighthouse (CI gate on every deploy): Performance ≥ 85 (measured 97–100),
  Accessibility 100, SEO 100, Best Practices ≥ 95 (measured 100).
- JSON-LD: Organization, WebSite, MobileApplication, FAQPage, BreadcrumbList.
- `hreflang` en-IN / hi-IN, sitemap (44 URLs), robots.txt, canonical URLs,
  one URL per page (no trailing-slash duplicates), social cards (EN/HI images).
- Strict Content-Security-Policy (hashes), HSTS, no framing, real 404 page.

## Deploying

Push to `main`: **GitHub Actions → "Website"** builds, runs Lighthouse, and
syncs to S3 with a deploy-only AWS role (GitHub OIDC, no stored keys), then
clears the CloudFront cache. Repo variables: `WEB_DEPLOY_ROLE_ARN`,
`WEB_BUCKET`, `CF_DISTRIBUTION_ID`.

## Domain (to do once)

1. Request the certificate in us-east-1 (needs admin rights once).
2. Add its validation CNAME at Hostinger; wait for "Issued".
3. Set `webDomain` + `webCertificateArn` (and `webOrigin`) in `infra/cdk.json`, deploy.
4. Add `lens` CNAME → the CloudFront domain at Hostinger. The cloudfront.net
   address then redirects to the domain.

## Still to do

- Analytics (GA4 / Cloudflare) and Search Console / Bing: later (owner decision).
- Download button → Google Play listing once published.
- Legal pages: confirm operator name, address and contact emails (`site/src/content/legal.ts` → `LEGAL`).
