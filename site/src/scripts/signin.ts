// Website sign-in: QR from the phone (primary), email code, or Google.
// The session always comes back as an HttpOnly cookie from /api: this script
// never sees or stores a token.
import { renderSVG } from 'uqr';

type Strings = Record<string, string>;
const root = document.getElementById('signin')!;
const s: Strings = JSON.parse(root.dataset.i18n ?? '{}');
const API = '/api/v1';

class ApiError extends Error {}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(API + path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-lens-web': '1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? s.genericError);
  return data as T;
}

/** Only same-site paths (no open redirects). */
function nextUrl(): string {
  const next = new URLSearchParams(location.search).get('next');
  return next && /^\/(?!\/)/.test(next) ? next : '/app/';
}

function done() {
  location.replace(nextUrl());
}

function setStatus(el: HTMLElement, text: string, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
}

// ---------- QR ----------

const qrBox = document.getElementById('qr')!;
const qrStatus = document.getElementById('qr-status')!;
let session: { id: string; secret: string; expiresAt: number } | null = null;
let pollTimer: number | undefined;

async function newQr() {
  window.clearTimeout(pollTimer);
  try {
    session = await call('POST', '/login-sessions');
    const link = `${location.origin}/l/${session!.id}/`;
    qrBox.innerHTML = renderSVG(link, { border: 1, ecc: 'M' });
    qrBox.querySelector('svg')?.setAttribute('aria-label', s.qrLabel);
    qrBox.querySelector('svg')?.setAttribute('role', 'img');
    setStatus(qrStatus, s.qrWaiting);
    poll();
  } catch (e) {
    setStatus(qrStatus, (e as Error).message, true);
    pollTimer = window.setTimeout(newQr, 10_000);
  }
}

async function poll() {
  if (!session) return;
  if (document.hidden) return; // resumes on visibilitychange
  // Refresh a few seconds before it expires so the code on screen always works.
  if (Date.now() > session.expiresAt - 8_000) return newQr();
  try {
    const r = await call<{ status: string }>('GET', `/login-sessions/${session.id}`, undefined, { 'x-login-secret': session.secret });
    if (r.status === 'approved') return done();
    if (r.status === 'denied') {
      setStatus(qrStatus, s.qrDenied, true);
      pollTimer = window.setTimeout(newQr, 4_000);
      return;
    }
  } catch {
    return newQr(); // expired or used: show a fresh code
  }
  pollTimer = window.setTimeout(poll, 2_000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session) {
    window.clearTimeout(pollTimer);
    poll();
  }
});

// ---------- Email code ----------

const emailForm = document.getElementById('email-form') as HTMLFormElement;
const codeForm = document.getElementById('code-form') as HTMLFormElement;
const emailStatus = document.getElementById('email-status')!;
let email = '';

emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = emailForm.querySelector('button')!;
  email = (emailForm.elements.namedItem('email') as HTMLInputElement).value.trim();
  button.disabled = true;
  setStatus(emailStatus, s.sending);
  try {
    await call('POST', '/web/auth/email/start', { email });
    emailForm.hidden = true;
    codeForm.hidden = false;
    setStatus(emailStatus, s.codeSent.replace('{email}', email));
    (codeForm.elements.namedItem('code') as HTMLInputElement).focus();
  } catch (err) {
    setStatus(emailStatus, (err as Error).message, true);
  } finally {
    button.disabled = false;
  }
});

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = codeForm.querySelector('button')!;
  const code = (codeForm.elements.namedItem('code') as HTMLInputElement).value.replace(/\D/g, '');
  button.disabled = true;
  setStatus(emailStatus, s.checking);
  try {
    await call('POST', '/web/auth/email/verify', { email, code });
    done();
  } catch (err) {
    setStatus(emailStatus, (err as Error).message, true);
    button.disabled = false;
  }
});

// ---------- Google (PKCE; the code returns in the URL fragment) ----------

const googleButton = document.getElementById('google') as HTMLButtonElement;
const PKCE_KEY = 'lens-pkce';

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

googleButton.addEventListener('click', async () => {
  googleButton.disabled = true;
  try {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const r = await call<{ url: string }>('POST', '/web/auth/google/start', { codeChallenge: challenge });
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, next: nextUrl() }));
    location.assign(r.url);
  } catch (err) {
    setStatus(emailStatus, (err as Error).message, true);
    googleButton.disabled = false;
  }
});

async function finishGoogle(params: URLSearchParams): Promise<boolean> {
  if (!params.has('code') && !params.has('error')) return false;
  history.replaceState(null, '', location.pathname + location.search);
  if (params.get('error')) {
    setStatus(emailStatus, params.get('error')!, true);
    return false;
  }
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as { verifier: string; next: string } | null;
  sessionStorage.removeItem(PKCE_KEY);
  if (!saved) {
    setStatus(emailStatus, s.genericError, true);
    return false;
  }
  setStatus(emailStatus, s.checking);
  try {
    await call('POST', '/web/auth/google', { code: params.get('code'), state: params.get('state'), codeVerifier: saved.verifier });
    location.replace(saved.next);
    return true;
  } catch (err) {
    setStatus(emailStatus, (err as Error).message, true);
    return false;
  }
}

// ---------- Start ----------

(async () => {
  if (await finishGoogle(new URLSearchParams(location.hash.slice(1)))) return;
  // Already signed in (the cookie works): go straight to the app.
  try {
    await call('GET', '/me');
    return done();
  } catch {
    // Not signed in: show the options.
  }
  newQr();
})();
