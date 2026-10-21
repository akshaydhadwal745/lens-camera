import { FormEvent, useEffect, useState } from 'react';
import { renderSVG } from 'uqr';

import { get, post } from './api';

const ERRORS: Record<string, string> = {
  denied: 'This Google account doesn’t have access to the Lens Console. Ask an owner to add you.',
  expired: 'Sign-in took too long or was opened in another tab. Please try again.',
  google: 'Google sign-in didn’t complete. Please try again.',
};

function Brand() {
  return (
    <div className="brand">
      <img src="/icon.svg" alt="" width={36} height={36} />
      <div>
        <div className="brand-name">Lens Console</div>
        <div className="muted small">Admin access only</div>
      </div>
    </div>
  );
}

export function Login() {
  const e = new URLSearchParams(location.search).get('e');
  return (
    <main className="auth">
      <div className="auth-card">
        <Brand />
        <h1>Sign in</h1>
        <p className="muted">Use your Google account, then the code from your authenticator app.</p>
        {e && <div className="notice error">{ERRORS[e] ?? 'Sign-in failed. Please try again.'}</div>}
        <a className="btn primary wide" href="/api/auth/google">
          Continue with Google
        </a>
        <p className="muted small">Every sign-in is recorded. Sessions end after 30 minutes without activity.</p>
      </div>
    </main>
  );
}

export function Verify({ email, enrolled, onDone }: { email: string; enrolled: boolean; onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enrolled) post<{ secret: string; uri: string }>('/auth/totp/setup').then(setSetup, (err: Error) => setError(err.message));
  }, [enrolled]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/totp', { code });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setCode('');
      if (/Sign in again/.test((err as Error).message)) setTimeout(() => location.assign('/login'), 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        <h1>{enrolled ? 'Enter your code' : 'Set up your authenticator'}</h1>
        <p className="muted">
          Signed in with Google as <strong>{email}</strong>.
        </p>
        {!enrolled && (
          <>
            <ol className="steps">
              <li>Open Google Authenticator, Microsoft Authenticator or 1Password on your phone.</li>
              <li>Add an account and scan this code.</li>
              <li>Type the 6-digit code it shows.</li>
            </ol>
            {setup ? (
              <div className="qr">
                <img src={`data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(setup.uri, { border: 2 }))}`} alt="Authenticator setup code" width={200} height={200} />
                <details>
                  <summary>Can’t scan? Enter this key</summary>
                  <code className="secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                </details>
              </div>
            ) : (
              !error && <div className="muted pad">Preparing…</div>
            )}
          </>
        )}
        <label className="field">
          <span>6-digit code</span>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            value={code}
            onChange={(ev) => setCode(ev.target.value.replace(/[^0-9 ]/g, ''))}
            required
          />
        </label>
        {error && <div className="notice error">{error}</div>}
        <button className="btn primary wide" disabled={busy || code.replace(/\s/g, '').length !== 6}>
          {busy ? 'Checking…' : 'Verify'}
        </button>
        <button type="button" className="btn ghost wide" onClick={() => post('/auth/logout').finally(() => location.assign('/login'))}>
          Use another account
        </button>
      </form>
    </main>
  );
}

export type SessionState = { stage: 'signed-out' } | { stage: 'mfa'; email: string; enrolled: boolean } | { stage: 'full'; email: string; role: string; expiresAt: number };

export const loadSession = () => get<SessionState>('/session');
