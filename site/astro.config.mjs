// lens.instagrowapp.com: marketing site (static HTML, almost no JS). The
// signed-in web app is the Expo export served under /app (see ../app.json).
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://lens.instagrowapp.com',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'always' },
  compressHTML: true,
  // Hashes for every inline script/style: a strict Content-Security-Policy.
  security: { csp: true },
  devToolbar: { enabled: false },
  integrations: [
    sitemap({
      // Sign-in and the app are private; the 404 isn't a page.
      filter: (page) => !/\/(signin|l|app)\//.test(page) && !page.endsWith('/404/'),
      i18n: { defaultLocale: 'en', locales: { en: 'en-IN', hi: 'hi-IN' } },
    }),
  ],
});
