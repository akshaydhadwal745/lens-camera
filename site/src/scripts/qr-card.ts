// The printable event QR card (pages/qr-card): only event album links of this site are drawn.
import { renderSVG } from 'uqr';

const params = new URLSearchParams(location.search);
const link = params.get('u') ?? '';
const name = (params.get('n') ?? '').slice(0, 80);
const card = document.getElementById('qc-card')!;
const error = document.getElementById('qc-error')!;

let ok = false;
try {
  const u = new URL(link);
  ok = u.origin === location.origin && /^\/e\/[A-Za-z0-9_-]{4,40}\/?$/.test(u.pathname);
} catch {
  ok = false;
}

if (ok) {
  document.getElementById('qc-qr')!.innerHTML = renderSVG(link, { border: 1, ecc: 'M' });
  if (name) document.getElementById('qc-name')!.textContent = name;
  card.hidden = false;
} else {
  error.hidden = false;
  (document.getElementById('qc-print') as HTMLButtonElement).disabled = true;
}
document.getElementById('qc-print')!.addEventListener('click', () => window.print());
