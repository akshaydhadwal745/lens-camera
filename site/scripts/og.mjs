// Makes the default social preview images (1200×630) for English and Hindi.
// Run once after a brand change: node scripts/og.mjs
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const icon = readFileSync(new URL('../../assets/brand/icon.svg', import.meta.url), 'utf8')
  .replace('<svg ', '<svg x="80" y="175" width="280" height="280" ');

const variants = {
  en: { title: 'Lens by InstaGrow', line1: 'Shoot endlessly.', line2: 'Your phone never fills up.', foot: 'Pro camera · 100 GB free backup · Original quality', font: 'Noto Sans' },
  hi: { title: 'Lens by InstaGrow', line1: 'जितनी चाहें फ़ोटो लें।', line2: 'फ़ोन कभी फ़ुल नहीं होगा।', foot: 'प्रो कैमरा · 100 GB मुफ़्त बैकअप · ओरिजिनल क्वालिटी', font: 'Noto Sans Devanagari' },
};

for (const [lang, v] of Object.entries(variants)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1020"/><stop offset="1" stop-color="#1E1B4B"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect x="80" y="175" width="280" height="280" rx="64" fill="#2563EB"/>
  ${icon}
  <text x="420" y="215" font-family="Noto Sans" font-size="34" font-weight="700" fill="#FACC15">${v.title}</text>
  <text x="420" y="300" font-family="${v.font}" font-size="64" font-weight="700" fill="#FFFFFF">${v.line1}</text>
  <text x="420" y="380" font-family="${v.font}" font-size="52" font-weight="700" fill="#C7D2FE">${v.line2}</text>
  <text x="420" y="470" font-family="${v.font}" font-size="28" fill="#94A3B8">${v.foot}</text>
</svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(new URL(`../public/og-${lang}.png`, import.meta.url).pathname);
  console.log('og', lang);
}
