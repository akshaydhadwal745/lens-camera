# Design: lens.instagrowapp.com, the website + web app

Status: **proposed (2026-10-09), waiting for approval.** Nothing is built yet.

Goal: one domain that (1) ranks on Google and converts visitors into app users,
and (2) is a real web extension of the app: sign in by scanning a QR with the
phone, then see, upload, share and manage everything from a browser.

## 1. What exists today (audit)

| Area | Today | Problem for this goal |
|---|---|---|
| Web app | Expo Router app exported as one SPA (`output: "single"`) on CloudFront `d13kuzzim5hg3c.cloudfront.net` | **2.9 MB JS** (≈700 KB gzipped) before anything shows; one HTML shell for every URL, so Google sees no content and no titles. Unusable for SEO. |
| Web sign-in | 8-character code typed from the phone (`POST /pairing/claim`) | Clumsy; the copy says "iPhone or iPad" |
| QR sign-in | **Already written** in `infra/lambda/api/identity.ts` (`/login-sessions`: create, info, approve, poll; 120 s TTL; token handed out once), **not routed** | Needs routing, a phone scanner and a web widget |
| Web token | `localStorage` | Readable by any injected script (XSS = account theft) |
| API | Lambda Function URL (separate domain) | Can't use secure cookies cross-site; CORS on every call |
| Web features | View, share link, open original, delete, account | No upload from computer, no trash/archive, read-only storage |
| Domain | `lens.instagrowapp.com` has no A/CNAME/TXT (only SES DKIM sub-records), DNS at Hostinger | Free to point at CloudFront; needs an ACM certificate in us-east-1 |
| Legal | No privacy policy, terms or account-deletion page | Google Play requires all three. The site is the place for them. |

## 2. Architecture options

| | A. Expo static rendering for everything | B. Next.js with server rendering (Lambda) | **C. Astro static site + the existing app under `/app` (recommended)** |
|---|---|---|---|
| Marketing page JS | ~700 KB (react-native-web) | ~90 KB+ | **~0–15 KB** (only interactive "islands") |
| Core Web Vitals | Poor LCP/INP on phones | Good | **Best** (static HTML from the CDN edge) |
| Reuses app code | Yes | No | **Yes**: `/app` is today's Expo web app, with the same store/API code |
| Running cost | S3+CF | Lambda per page view + ops | **S3+CF only** (≈ $0 at our traffic) |
| Content workflow | TSX | MDX | **Markdown/MDX** pages and blog, typed content collections |

**C** keeps the marketing site as pure HTML/CSS (fast, crawlable) and the app
as the app. No business logic is duplicated: the web app keeps calling the
same API; the marketing site only has the QR widget, which calls the existing
`/login-sessions` endpoints.

```
lens.instagrowapp.com  (CloudFront, one distribution, HTTP/2+3, Brotli)
├── /                 Astro static pages (S3)       index, cacheable
├── /features/*       Astro                          index
├── /blog/*           Astro (MDX)                    index
├── /help, /privacy, /terms, /delete-account         index
├── /link             QR sign-in page (Astro island)    noindex
├── /app/*            Expo web app (SPA, S3)            noindex, signed-in area
├── /api/*            → Lambda Function URL (no cache)   same-origin API
├── /.well-known/assetlinks.json, apple-app-site-association   app links
└── m/*, d/*, t/*     signed media (unchanged)
```

## 3. Sign-in: QR first, secure by default

**Flow (WhatsApp-Web style, built on the existing endpoints):**
1. The browser opens `/link` and gets `{id, secret}` from `POST /api/login-sessions`.
   It shows a QR for `https://lens.instagrowapp.com/l/<id>`, refreshed every
   ~100 s, and polls with the secret.
2. The phone scans it, either with **any camera app** (Android App Links /
   iOS Universal Links open Lens directly) or with Lens → Settings → **Link a computer**.
3. The phone shows **"Chrome on Windows · near <city> wants to sign in to
   your account"**, with **Approve** / **Deny**. It warns "only approve a code
   on a screen in front of you" (protects against QR phishing).
4. The browser's next poll gets the session. Done in about 3 seconds.

**Security upgrades:**
- **HttpOnly, Secure, SameSite=Strict session cookie** instead of
  `localStorage`. Injected scripts can't read it. That's possible because the
  API moves to the same domain (`/api/*` via CloudFront). Mutating requests also
  require a custom header (CSRF guard). The phone apps keep their bearer tokens.
- Web sessions: 30-day sliding expiry, listed on the phone (existing
  `/web-sessions`), with **Log out this browser / all browsers** on both sides.
- Strict security headers on every response (CloudFront response-headers
  policy): CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors none.
- QR sessions: random 16-byte id, the secret never leaves the browser, 120 s
  TTL, single use, plus a loose per-IP brake (CGNAT-safe, like registration).
- Fallback: **email code** sign-in on the web (existing `/auth/email/*`) for
  people without their phone; Google sign-in later.

## 4. What signed-in users can do on the web (`/app`)

Everything reuses the existing API:
- Gallery and viewer at full quality (the "never below the original" rules), zoom, slideshow, keyboard.
- **New: upload from the computer.** Drag and drop folders. Resumable,
  MD5-checked multipart, same as the phones. Big win: people back up old
  photos from a laptop.
- Download originals (single, or a zip of a selection).
- Share / send to friends, Shared tab.
- Trash and Archive: restore, delete forever.
- Storage: Lens storage usage, connected storages (view), request a provider.
- Account: devices and browsers, log out.

Not on the web: the camera and phone-only settings.

## 5. SEO and discoverability plan

- **Brand problem to solve now:** "Lens" collides with **Google Lens** and
  won't rank on its own. Use a distinct brand in titles and schema, e.g. **"Lens by
  InstaGrow"** (or a new name), and target the *problems* people search for.
- **Page set (each with a real search intent):**
  - Home
  - Features: pro camera, Night, Portrait, looks and editor, 100 GB free
    backup, your own storage (Google Drive / OneDrive / Dropbox / Box / S3 / NAS),
    4K video streaming, sharing
  - Use cases: "phone storage full", trips, weddings/events, photographers
  - Pricing
  - Download
  - Security and privacy
  - Help/FAQ
  - Blog (guides such as "how to free up phone storage without losing photos")
- **Technical SEO:** static HTML, one `<h1>`, unique titles and descriptions,
  canonical URLs (the old `cloudfront.net` host redirects to the domain),
  `sitemap.xml` (auto), `robots.txt`, Open Graph/Twitter cards with generated
  1200×630 images, breadcrumbs, clean URLs, 404 page with links, `noindex` on `/app` and `/link`.
- **Structured data (JSON-LD):** `Organization`, `WebSite`,
  `MobileApplication` (Android, free, features), `FAQPage`, `BreadcrumbList`, `Article`.
- **Core Web Vitals targets:** LCP < 1.8 s on a mid-range phone on 4G, CLS < 0.02, INP < 100 ms.
  - Zero JS by default.
  - AVIF/WebP responsive images with fixed sizes.
  - Self-hosted subset font, or the system font stack.
  - Critical CSS inlined.
  - Hashed assets cached for 1 year; HTML cached at the edge with a short TTL and invalidated on deploy.
- **Accessibility:** WCAG 2.2 AA (contrast, focus, keyboard, reduced motion, alt text).
- **Quality gates in CI:** Lighthouse CI budgets (Performance ≥ 95, Accessibility 100, SEO 100, Best Practices 100), plus a broken-link check.
- **After launch:** Google Search Console and Bing Webmaster (DNS TXT at
  Hostinger), sitemap submission, and Hindi pages for India later (hreflang).

## 6. Conversion ideas

- Desktop visitors: "Scan to get the app" QR (APK now, Play Store later).
- Phone visitors: a sticky "Get the app" button and an App Link into the installed app.
- Shared links (`/s/...`) show a rich preview and "Get Lens to save this".
  These pages are noindex (private), and they're the viral loop.
- Clear trust signals: originals never re-compressed, 1-year deleted-items
  archive, India servers (ap-south-1), delete your account anytime.

## 7. Hosting, deploy, cost

- Same CloudFront distribution and web bucket. Add the domain, an ACM
  certificate (us-east-1, free; you add one validation CNAME at Hostinger),
  routes for `/api` and `/app`, a URL-rewrite function and security headers.
- Builds on **GitHub Actions** (your PC stays free). Deploys the site with a
  GitHub OIDC role that can only write the web bucket and invalidate the CDN (no keys stored).
- Cost: S3 + CloudFront for a static site is effectively **$0–1/month** at
  launch (1 TB/month CloudFront free tier). API calls through CloudFront add
  ~$0.01 per 10,000.

## 8. Build order

1. Infra: domain + certificate, CloudFront routes (`/api`, `/app`, rewrites,
   headers, canonical host), OIDC deploy role, CI web build and deploy.
2. Marketing site (Astro): design system, home, feature/use-case pages,
   legal pages (privacy, terms, **delete account**: Play requirement), help,
   structured data, sitemap, OG images, Lighthouse CI.
3. Sign-in: route the QR endpoints, cookie sessions via `/api`, `/link`
   widget, phone "Link a computer" scanner + App Links, email-code fallback.
4. Web app at `/app`: move under `/app`, upload from computer, downloads,
   trash/archive, polish.
5. Blog and first guides; Search Console, Bing; analytics.
