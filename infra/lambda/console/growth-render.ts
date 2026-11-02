// Headless Chromium for the agent's competitor_page tool: some competitor sites (TeraBox) send an empty
// page and draw everything with JavaScript, so a plain fetch sees only the title. Used only when the
// plain fetch finds almost no text. @sparticuz/chromium is a Chromium build made for Lambda (no GPU,
// /tmp only); locally set GROWTH_CHROME to a Chrome binary. Images, media and fonts are not loaded,
// and the page may not reach private or loopback addresses (the Lambda runtime API is on 127.0.0.1).

/** Hosts a rendered page must never reach: loopback, link-local (metadata), private ranges. */
export function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h === '::1' || h === '0.0.0.0') return true;
  if (/^(fc|fd|fe80)[0-9a-f]*:/.test(h)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Load the page in Chromium and return the HTML after scripts ran. */
export async function renderPage(url: string, timeoutMs = 25_000): Promise<{ status: number; html: string; finalUrl: string }> {
  const puppeteer = await import('puppeteer-core');
  let executablePath = process.env.GROWTH_CHROME ?? '';
  let args = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
  if (!executablePath) {
    const chromium = (await import('@sparticuz/chromium')).default;
    executablePath = await chromium.executablePath();
    args = chromium.args;
  }
  const browser = await puppeteer.launch({ executablePath, args, headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 LensGrowthAudit/1.0');
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      let blocked = ['image', 'media', 'font'].includes(r.resourceType());
      try {
        const u = new URL(r.url());
        if (!['http:', 'https:', 'data:', 'blob:'].includes(u.protocol) || ((u.protocol === 'http:' || u.protocol === 'https:') && privateHost(u.hostname))) blocked = true;
      } catch {
        blocked = true;
      }
      void (blocked ? r.abort() : r.continue());
    });
    let status = 0;
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
      status = res?.status() ?? 0;
    } catch {
      // Busy pages never go network-idle: keep whatever has rendered so far.
    }
    return { status, html: await page.content(), finalUrl: page.url() };
  } finally {
    await browser.close();
  }
}
