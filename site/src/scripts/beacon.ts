// Our own website analytics (infra/lambda/api/web-events.ts): one tiny event per page view, per
// important click and when a page is left (time visible, scroll depth). No cookies, no IDs, nothing
// about the visitor: the server keeps daily totals only. The browser tab (session storage, cleared
// when the tab closes) remembers only this visit's landing page, page count and whether it engaged.
const send = (data: Record<string, unknown>) => {
  try {
    const body = JSON.stringify(data);
    if (!navigator.sendBeacon?.('/api/v1/web-events', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/v1/web-events', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true });
    }
  } catch {
    // analytics never breaks the page
  }
};
const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      // storage blocked: this page still counts, the visit just isn't linked
    }
  },
};

const path = location.pathname;
// First page of this tab's visit: counts a visit, where it came from and where it landed.
const first = store.get('lv') ? 0 : 1;
if (first) {
  store.set('lv', '1');
  store.set('ll', path);
}
const landing = store.get('ll') ?? path;
const pages = Number(store.get('lp') ?? '0') + 1;
store.set('lp', String(pages));
const q = new URLSearchParams(location.search);
send(
  first
    ? { p: path, v: 1, r: document.referrer || undefined, s: q.get('utm_source') ?? undefined, m: q.get('utm_medium') ?? undefined, c: q.get('utm_campaign') ?? undefined }
    : { p: path, v: 0 },
);

// Engaged visit (counted once): a second page, or 10 seconds on the page.
const engage = () => {
  if (store.get('le')) return;
  store.set('le', '1');
  send({ p: path, x: 'engaged', l: landing });
};
if (pages >= 2) engage();

// Time the page was visible and how far it was scrolled, sent when the page is hidden or left.
let visibleMs = 0;
let since = document.visibilityState === 'visible' ? performance.now() : -1;
let maxScroll = 0;
let sent = false;
const timer = setTimeout(engage, 10_000);
const scrolled = () => {
  const h = document.documentElement.scrollHeight - innerHeight;
  maxScroll = Math.max(maxScroll, h > 0 ? Math.min(100, Math.round((scrollY / h) * 100)) : 100);
};
addEventListener('scroll', scrolled, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (since >= 0) visibleMs += performance.now() - since;
    since = -1;
    clearTimeout(timer);
    if (!sent) {
      sent = true;
      scrolled();
      send({ p: path, x: 'end', t: Math.round(visibleMs / 1000), sc: maxScroll });
    }
  } else since = performance.now();
});

// Clicks that matter: getting the app, signing in, the web app.
document.addEventListener(
  'click',
  (e) => {
    const a = (e.target as Element | null)?.closest?.('a, button, label');
    if (!a) return;
    const tagged = a.getAttribute('data-track');
    const href = a instanceof HTMLAnchorElement ? a.href : '';
    const event =
      tagged ??
      (/\.apk(\?|$)/.test(href)
        ? 'apk_download'
        : /play\.google\.com/.test(href)
          ? 'play_store'
          : /\/download\/?$/.test(new URL(href || location.href, location.href).pathname) && href
            ? 'get_lens'
            : /\/signin\/?$/.test(href)
              ? 'signin'
              : /\/app\/?/.test(href)
                ? 'web_app'
                : null);
    if (!event) return;
    send({ p: path, e: event, l: landing });
    // The same click as a GA4 event (no-op where Google Analytics isn't loaded or was declined).
    (window as { gtag?: (...a: unknown[]) => void }).gtag?.('event', event, { page_path: path, landing_page: landing });
  },
  { capture: true },
);
