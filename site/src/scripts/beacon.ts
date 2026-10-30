// Our own website analytics (infra/lambda/api/web-events.ts): one tiny event per page view and per
// important click. No cookies, no IDs, nothing about the visitor: the server keeps daily totals only.
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

const path = location.pathname;
let first = 0;
try {
  // First page of this tab's visit: counts a visit and where it came from.
  if (!sessionStorage.getItem('lv')) {
    sessionStorage.setItem('lv', '1');
    first = 1;
  }
} catch {
  first = 0;
}
const utm = new URLSearchParams(location.search).get('utm_source') ?? undefined;
send({ p: path, v: first, r: first ? document.referrer || undefined : undefined, s: first ? utm : undefined });

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
    send({ p: path, e: event });
    // The same click as a GA4 event (no-op where Google Analytics isn't loaded or was declined).
    (window as { gtag?: (...a: unknown[]) => void }).gtag?.('event', event, { page_path: path });
  },
  { capture: true },
);
