import { FormEvent, useEffect, useState } from 'react';

import { get, post } from '../api';
import { Badge, Card, date, Empty, Loaded, n, Page, Tabs, useLoad } from '../ui';

type Audience = {
  signedIn?: 'any' | 'yes' | 'no';
  plans?: string[];
  activeWithinDays?: number;
  inactiveForDays?: number;
  installedWithinDays?: number;
  minStoragePct?: number;
  hasShared?: 'any' | 'yes' | 'no';
  regions?: string[];
  builds?: string[];
};
type Campaign = {
  id: string;
  title: string;
  body: string;
  route: string;
  category: string;
  audience: Audience & { only?: string[] };
  status: 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduledAt: number;
  createdAt: number;
  createdBy: string;
  finishedAt?: number;
  stats: Record<string, number>;
};

const ROUTES = [
  ['/', 'Camera'],
  ['/gallery', 'Library'],
  ['/invite', 'Invite friends'],
  ['/storage', 'Storage'],
  ['/albums', 'Albums'],
  ['/recaps', 'Recaps'],
  ['/people', 'People'],
  ['/places', 'Places'],
  ['/settings', 'Settings'],
  ['/feedback', 'Feedback'],
  ['/links', 'Share links'],
];
const LIFECYCLE: Record<string, string> = {
  welcome_ending: 'Welcome ending (14, 3, 1 days)',
  backups_paused: 'Backups paused',
  weekly_summary: 'Weekly summary',
  recap_ready: 'Trip / event recap ready',
  on_this_day: 'On this day',
};
const pct = (a?: number, b?: number) => (a && b ? `${Math.round((a / b) * 100)}%` : '—');

export function Notifications() {
  const [tab, setTab] = useState<'campaigns' | 'new' | 'automatic'>('campaigns');
  return (
    <Page
      title="Notifications"
      actions={
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'campaigns', label: 'Campaigns' },
            { value: 'new', label: 'New' },
            { value: 'automatic', label: 'Automatic' },
          ]}
        />
      }
    >
      <p className="muted small">
        Sent to people’s phones between 9:00 and 21:00 their time, at most 2 notifications a day and 1 news message a week per person. People turn categories off in Lens → Settings → Notifications;
        “Account” notices (storage plan) can’t be turned off. Test accounts never receive campaigns.
      </p>
      {tab === 'campaigns' && <CampaignList onNew={() => setTab('new')} />}
      {tab === 'new' && <Compose onDone={() => setTab('campaigns')} />}
      {tab === 'automatic' && <Automatic />}
    </Page>
  );
}

function CampaignList({ onNew }: { onNew: () => void }) {
  const state = useLoad(() => get<{ campaigns: Campaign[] }>('/notifications'), []);
  useEffect(() => {
    const t = setInterval(state.reload, 60_000);
    return () => clearInterval(t);
  }, [state.reload]);
  async function stop(id: string) {
    if (!confirm('Stop this campaign? Nobody else will get it.')) return;
    await post(`/notifications/${id}/stop`).catch((e: Error) => alert(e.message));
    state.reload();
  }
  return (
    <Loaded state={state}>
      {(d) =>
        d.campaigns.length ? (
          <div className="list">
            {d.campaigns.map((c) => {
              const s = c.stats ?? {};
              return (
                <article key={c.id} className="item">
                  <header>
                    <Badge tone={c.status === 'sent' ? 'good' : c.status === 'cancelled' ? 'plain' : 'warn'}>{c.status}</Badge>
                    <strong>{c.title}</strong>
                    <span className="muted small">
                      {c.audience.only ? 'test send · ' : ''}
                      {c.category} · {c.status === 'scheduled' ? `starts ${date(c.scheduledAt)}` : `started ${date(c.scheduledAt)}`} · by {c.createdBy}
                    </span>
                  </header>
                  <p className="msg">{c.body}</p>
                  <div className="campaign-stats">
                    <span>
                      <strong>{n(s.targeted ?? 0)}</strong> targeted
                    </span>
                    <span>
                      <strong>{n(s.sent ?? 0)}</strong> sent
                    </span>
                    <span>
                      <strong>{n(s.opened ?? 0)}</strong> opened <span className="muted">{pct(s.opened, s.sent)}</span>
                    </span>
                    <span className="muted">
                      {n(s.off ?? 0)} turned off · {n(s.capped ?? 0)} over the limit · {n(s['no-device'] ?? 0)} no phone · {n(s.failed ?? 0)} failed · {n(s.expired ?? 0)} expired
                    </span>
                  </div>
                  {(c.status === 'scheduled' || c.status === 'sending') && (
                    <footer>
                      <span className="muted small">{c.status === 'sending' ? 'Sending as each person’s daytime comes round (up to 24 h).' : 'Starts within 15 minutes of the time.'}</span>
                      <button className="btn danger" onClick={() => stop(c.id)}>
                        Stop
                      </button>
                    </footer>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <Empty>
            No campaigns yet.{' '}
            <button className="btn" onClick={onNew}>
              Write one
            </button>
          </Empty>
        )
      }
    </Loaded>
  );
}

function Compose({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [route, setRoute] = useState('/');
  const [category, setCategory] = useState<'news' | 'account'>('news');
  const [audience, setAudience] = useState<Audience>({ signedIn: 'any', hasShared: 'any' });
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [size, setSize] = useState<{ matched: number; reachable: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setSize(null);
    const t = setTimeout(() => {
      post<{ matched: number; reachable: number }>('/notifications/estimate', { audience }).then(setSize, (e: Error) => setError(e.message));
    }, 500);
    return () => clearTimeout(t);
  }, [audience]);

  const set = (patch: Partial<Audience>) => setAudience((a) => ({ ...a, ...patch }));
  const numberOrUndef = (v: string) => (v === '' ? undefined : Number(v));
  const payload = () => ({ title, body, route, category, audience, scheduledAt: when === 'later' && at ? new Date(at).getTime() : undefined });

  async function testSend() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await post('/notifications', { ...payload(), test: true });
      setNotice('Test send queued to your own Lens account (it arrives within 15 minutes, during your daytime).');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!size) return;
    if (!confirm(`${when === 'now' ? 'Send' : 'Schedule'} to ${size.matched} people (${size.reachable} with notifications on)?`)) return;
    setBusy(true);
    setError('');
    try {
      await post('/notifications', payload());
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid2" onSubmit={submit}>
      <Card title="Message">
        <div className="form">
          <label className="field-row">
            <span>Headline</span>
            <input maxLength={65} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Your trip photos, all in one place" />
            <span className="muted small">{title.length}/65</span>
          </label>
          <label className="field-row">
            <span>Message</span>
            <textarea maxLength={240} required rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Make an event album and let everyone add their photos with one QR code." />
            <span className="muted small">{body.length}/240</span>
          </label>
          <label className="field-row">
            <span>Opens</span>
            <select value={route} onChange={(e) => setRoute(e.target.value)}>
              {ROUTES.map(([r, l]) => (
                <option key={r} value={r}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span>Type</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as 'news' | 'account')}>
              <option value="news">News & tips (people can turn it off; max 1 a week)</option>
              <option value="account">Account notice (storage/plan changes only)</option>
            </select>
          </label>
          <div className="phone-preview" aria-label="Preview">
            <div className="pp-app">Lens · now</div>
            <div className="pp-title">{title || 'Headline'}</div>
            <div className="pp-body">{body || 'Message'}</div>
          </div>
        </div>
      </Card>
      <Card title="Who gets it">
        <div className="form">
          <label className="field-row">
            <span>Signed in</span>
            <select value={audience.signedIn} onChange={(e) => set({ signedIn: e.target.value as Audience['signedIn'] })}>
              <option value="any">Everyone</option>
              <option value="yes">Signed in only</option>
              <option value="no">Guests only</option>
            </select>
          </label>
          <label className="field-row">
            <span>Plan</span>
            <select value={audience.plans?.[0] ?? ''} onChange={(e) => set({ plans: e.target.value ? [e.target.value] : undefined })}>
              <option value="">Any</option>
              <option value="welcome">In the 40 GB welcome</option>
              <option value="free">Free (after welcome)</option>
              <option value="guest">Guest</option>
            </select>
          </label>
          <label className="field-row">
            <span>Used Lens in the last … days</span>
            <input type="number" min={1} max={365} value={audience.activeWithinDays ?? ''} onChange={(e) => set({ activeWithinDays: numberOrUndef(e.target.value) })} placeholder="any" />
          </label>
          <label className="field-row">
            <span>Not used Lens for … days</span>
            <input type="number" min={1} max={365} value={audience.inactiveForDays ?? ''} onChange={(e) => set({ inactiveForDays: numberOrUndef(e.target.value) })} placeholder="any" />
          </label>
          <label className="field-row">
            <span>Installed in the last … days</span>
            <input type="number" min={1} max={3650} value={audience.installedWithinDays ?? ''} onChange={(e) => set({ installedWithinDays: numberOrUndef(e.target.value) })} placeholder="any" />
          </label>
          <label className="field-row">
            <span>Lens storage at least … % full</span>
            <input type="number" min={1} max={100} value={audience.minStoragePct ?? ''} onChange={(e) => set({ minStoragePct: numberOrUndef(e.target.value) })} placeholder="any" />
          </label>
          <label className="field-row">
            <span>Has shared</span>
            <select value={audience.hasShared} onChange={(e) => set({ hasShared: e.target.value as Audience['hasShared'] })}>
              <option value="any">Doesn’t matter</option>
              <option value="yes">Has shared</option>
              <option value="no">Never shared</option>
            </select>
          </label>
          <label className="field-row">
            <span>Region (2 letters, comma-separated)</span>
            <input
              value={(audience.regions ?? []).join(', ')}
              onChange={(e) => set({ regions: e.target.value.toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z]{2}$/.test(x)) })}
              placeholder="any, e.g. IN, US"
            />
          </label>
          <div className="audience-size">{size ? `${n(size.matched)} people · ${n(size.reachable)} with notifications on` : 'Counting…'}</div>
          <label className="field-row">
            <span>When</span>
            <select value={when} onChange={(e) => setWhen(e.target.value as 'now' | 'later')}>
              <option value="now">Now (within 15 minutes, in each person’s daytime)</option>
              <option value="later">At a time…</option>
            </select>
          </label>
          {when === 'later' && <input type="datetime-local" required value={at} onChange={(e) => setAt(e.target.value)} />}
          {error && <div className="notice error">{error}</div>}
          {notice && <div className="notice">{notice}</div>}
          <div className="btns">
            <button type="button" className="btn" disabled={busy || !title || !body} onClick={testSend}>
              Send me a test
            </button>
            <button className="btn primary" disabled={busy || !title || !body || !size?.matched}>
              {when === 'now' ? 'Send' : 'Schedule'}
            </button>
          </div>
        </div>
      </Card>
    </form>
  );
}

function Automatic() {
  const state = useLoad(() => get<{ days: number; lifecycle: Record<string, Record<string, number>>; optouts: Record<string, number> }>('/notifications/lifecycle?days=30'), []);
  return (
    <Loaded state={state}>
      {(d) => (
        <>
          <Card title="Automatic notifications (last 30 days)">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Notification</th>
                    <th className="num">Sent</th>
                    <th className="num">Opened</th>
                    <th className="num">Open rate</th>
                    <th className="num">Over the limit</th>
                    <th className="num">Turned off</th>
                    <th className="num">No phone</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(LIFECYCLE).map(([key, label]) => {
                    const s = d.lifecycle[key] ?? {};
                    return (
                      <tr key={key}>
                        <td>{label}</td>
                        <td className="num">{n(s.sent ?? 0)}</td>
                        <td className="num">{n(s.opened ?? 0)}</td>
                        <td className="num">{pct(s.opened, s.sent)}</td>
                        <td className="num">{n(s.capped ?? 0)}</td>
                        <td className="num">{n(s.off ?? 0)}</td>
                        <td className="num">{n(s['no-device'] ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">Each is sent once, around 10:00 on the person’s phone. Shares, friends joining and storage-full alerts are sent the moment they happen and aren’t limited.</p>
          </Card>
          <Card title="People who turned a category off (last 30 days)">
            {Object.keys(d.optouts).length ? (
              <dl className="facts">
                {Object.entries(d.optouts).map(([k, v]) => (
                  <OptRow key={k} k={k} v={v} />
                ))}
              </dl>
            ) : (
              <Empty>Nobody turned notifications off.</Empty>
            )}
          </Card>
        </>
      )}
    </Loaded>
  );
}

function OptRow({ k, v }: { k: string; v: number }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{n(v)}</dd>
    </>
  );
}
