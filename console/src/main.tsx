import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { get, Me, post, whenSignedOut } from './api';
import { loadSession, Login, SessionState, Verify } from './auth';
import { Account } from './pages/account';
import { Activity } from './pages/activity';
import { Analytics } from './pages/analytics';
import { Affiliates, Payouts, Referrals } from './pages/programs';
import { Feedback, Inbox } from './pages/support';
import { Overview } from './pages/overview';
import { Notifications } from './pages/notifications';
import { Phones } from './pages/phones';
import { Costs, Errors, Health } from './pages/system';
import { Team } from './pages/team';
import { UserDetail, Users } from './pages/users';
import { Link, navigate, usePath } from './ui';
import './styles.css';

type Section = { path: string; label: string; permission: string; group: string };

const SECTIONS: Section[] = [
  { path: '/', label: 'Overview', permission: 'overview', group: 'Insights' },
  { path: '/analytics', label: 'Analytics', permission: 'analytics', group: 'Insights' },
  { path: '/phones', label: 'Phones', permission: 'phones', group: 'Insights' },
  { path: '/users', label: 'Users', permission: 'users', group: 'Operate' },
  { path: '/feedback', label: 'Feedback & reports', permission: 'feedback', group: 'Operate' },
  { path: '/inbox', label: 'Inbox', permission: 'inbox', group: 'Operate' },
  { path: '/notifications', label: 'Notifications', permission: 'notifications', group: 'Operate' },
  { path: '/affiliates', label: 'Affiliates', permission: 'affiliates', group: 'Programs' },
  { path: '/referrals', label: 'Referrals', permission: 'referrals', group: 'Programs' },
  { path: '/payouts', label: 'Payouts', permission: 'payouts', group: 'Programs' },
  { path: '/health', label: 'Health', permission: 'health', group: 'System' },
  { path: '/errors', label: 'App errors', permission: 'errors', group: 'System' },
  { path: '/costs', label: 'AWS costs', permission: 'costs', group: 'System' },
  { path: '/activity', label: 'Activity log', permission: 'audit', group: 'Admin' },
  { path: '/team', label: 'Team', permission: 'team', group: 'Admin' },
];

function Shell({ me, expiresAt }: { me: Me; expiresAt: number }) {
  const path = usePath();
  const [menu, setMenu] = useState(false);
  const allowed = SECTIONS.filter((s) => me.permissions.includes(s.permission));
  const pathname = path.split('?')[0];
  const active = allowed.find((s) => (s.path === '/' ? pathname === '/' : pathname.startsWith(s.path)));
  useEffect(() => setMenu(false), [path]);

  let page: React.ReactNode;
  if (pathname === '/account') page = <Account />;
  else if (pathname.startsWith('/users/') && me.permissions.includes('users')) page = <UserDetail id={decodeURIComponent(pathname.slice(7))} canWrite={me.permissions.includes('users.write')} />;
  else if (!active) page = allowed[0] ? <NotFound to={allowed[0].path} /> : <NoAccess />;
  else {
    page = {
      '/': <Overview />,
      '/analytics': <Analytics />,
      '/phones': <Phones />,
      '/users': <Users />,
      '/feedback': <Feedback canWrite={me.permissions.includes('feedback.write')} />,
      '/inbox': <Inbox canWrite={me.permissions.includes('inbox.write')} />,
      '/notifications': <Notifications />,
      '/affiliates': <Affiliates />,
      '/referrals': <Referrals />,
      '/payouts': <Payouts />,
      '/health': <Health />,
      '/errors': <Errors />,
      '/costs': <Costs />,
      '/activity': <Activity />,
      '/team': <Team me={me.email} />,
    }[active.path];
  }

  const groups = [...new Set(allowed.map((s) => s.group))];
  return (
    <div className={menu ? 'shell menu-open' : 'shell'}>
      <aside className="side">
        <div className="side-brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>Lens Console</span>
        </div>
        <nav>
          {groups.map((g) => (
            <div key={g} className="nav-group">
              <div className="nav-title">{g}</div>
              {allowed
                .filter((s) => s.group === g)
                .map((s) => (
                  <Link key={s.path} to={s.path} className={active?.path === s.path ? 'nav-item on' : 'nav-item'}>
                    {s.label}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <Link to="/account" className={pathname === '/account' ? 'nav-item on' : 'nav-item'}>
            <span className="who">
              <span className="who-email">{me.email}</span>
              <span className="who-role">{me.role}</span>
            </span>
          </Link>
          <button className="btn ghost wide" onClick={() => post('/auth/logout').finally(() => location.assign('/login'))}>
            Sign out
          </button>
          <SessionClock expiresAt={expiresAt} />
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="btn ghost" aria-label="Menu" onClick={() => setMenu((m) => !m)}>
            ☰
          </button>
          <span>Lens Console</span>
        </div>
        {page}
      </div>
    </div>
  );
}

function SessionClock({ expiresAt }: { expiresAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((expiresAt - Date.now()) / 60_000));
  return <div className="muted small">Session: ends after 30 min idle{left < 31 ? ` (${left} min)` : ''}</div>;
}

function NotFound({ to }: { to: string }) {
  useEffect(() => navigate(to), [to]);
  return null;
}

function NoAccess() {
  return <div className="notice">Your role has no sections yet. Ask an owner.</div>;
}

function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const path = usePath();

  const refresh = useCallback(async () => {
    try {
      const s = await loadSession();
      setSession(s);
      setMe(s.stage === 'full' ? await get<Me>('/me') : null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    whenSignedOut(() => {
      setSession({ stage: 'signed-out' });
      setMe(null);
    });
    void refresh();
  }, [refresh]);

  // Keep the session clock honest (the server ends idle sessions; this notices it).
  useEffect(() => {
    if (session?.stage !== 'full') return;
    const t = setInterval(() => void refresh(), 5 * 60_000);
    return () => clearInterval(t);
  }, [session?.stage, refresh]);

  if (error) return <div className="notice error pad">{error}</div>;
  if (!session) return <div className="muted pad">Loading…</div>;
  if (session.stage === 'signed-out') {
    if (!path.startsWith('/login')) history.replaceState(null, '', '/login');
    return <Login />;
  }
  if (session.stage === 'mfa') {
    if (!path.startsWith('/verify')) history.replaceState(null, '', '/verify');
    return (
      <Verify
        email={session.email}
        enrolled={session.enrolled}
        onDone={() => {
          history.replaceState(null, '', '/');
          void refresh();
        }}
      />
    );
  }
  if (path.startsWith('/login') || path.startsWith('/verify')) history.replaceState(null, '', '/');
  if (!me) return <div className="muted pad">Loading…</div>;
  return <Shell me={me} expiresAt={session.expiresAt} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
