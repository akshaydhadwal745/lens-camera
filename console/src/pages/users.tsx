import { FormEvent, useState } from 'react';

import { get, post } from '../api';
import { Badge, bytes, Card, date, Empty, Link, Loaded, n, Page, useLoad, when } from '../ui';

type User = { id: string; name: string; email?: string; signedIn: boolean; createdAt: number; usedBytes: number; bonusBytes: number; logins: string[]; test: boolean };

export function Users() {
  const params = new URLSearchParams(location.search);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(q);
  const [tests, setTests] = useState(false);
  const state = useLoad(() => get<{ users: User[]; total?: number }>(`/users?q=${encodeURIComponent(query)}${tests ? '&tests=1' : ''}`), [query, tests]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setQuery(q.trim());
    history.replaceState(null, '', q.trim() ? `/users?q=${encodeURIComponent(q.trim())}` : '/users');
  }

  return (
    <Page title="Users">
      <form className="toolbar" onSubmit={submit}>
        <input className="search" placeholder="Search by email, name or account ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Search</button>
        <label className="check">
          <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} /> Show test accounts
        </label>
      </form>
      <Loaded state={state}>
        {(d) =>
          d.users.length ? (
            <Card>
              <div className="muted small pad-b">
                {d.total !== undefined && d.total > d.users.length ? `Newest ${d.users.length} of ${n(d.total)}` : `${n(d.users.length)} accounts`}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Email</th>
                      <th>Sign-in</th>
                      <th className="num">Lens storage</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Link to={`/users/${encodeURIComponent(u.id)}`}>{u.name}</Link> {u.test && <Badge>test</Badge>}
                        </td>
                        <td>{u.email ?? <span className="muted">guest</span>}</td>
                        <td>{u.logins.length ? u.logins.join(', ') : <span className="muted">—</span>}</td>
                        <td className="num">{bytes(u.usedBytes)}</td>
                        <td title={date(u.createdAt)}>{when(u.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Empty>No accounts match.</Empty>
          )
        }
      </Loaded>
    </Page>
  );
}

type Detail = {
  user: User;
  attribution: { program: string; source?: string; at?: number } | null;
  referral: string | null;
  storage: {
    quotaBytes: number;
    welcomeUntil: number | null;
    plan: { id: string; status: 'active' | 'grace' | 'lapsed'; provider: string; periodEnd: number; graceUntil?: number; lapsedAt?: number; cancelled?: boolean } | null;
    overLimitSince: number | null;
    deletionAt: number | null;
  };
  media: { items: number; photos: number; videos: number; pending: number; inTrash: number; archived: number; lensBytes: number; ownStorageItems: number; lastUploadAt: number | null };
  devices: { name: string; web: boolean; since: number; lastUsedAt: number }[];
  sharing: { links: number; albums: number };
  programs: { affiliate: string | null; invites: number; invitesByState: Record<string, number> };
};

export function UserDetail({ id, canWrite }: { id: string; canWrite: boolean }) {
  const state = useLoad(() => get<Detail>(`/users/${encodeURIComponent(id)}`), [id]);
  const planAction = async (action: 'grant' | 'payment-failed' | 'end', extra: Record<string, unknown> = {}) => {
    const what = action === 'grant' ? `Give ${extra.months} month(s) of ${extra.planId} free?` : action === 'payment-failed' ? 'Mark the renewal as failed (7-day grace starts)?' : 'End the plan now (back to Free, nothing deleted)?';
    if (!confirm(what)) return;
    await post(`/users/${encodeURIComponent(id)}/plan`, { action, ...extra }).catch((e: Error) => alert(e.message));
    state.reload();
  };
  return (
    <Page title="Account" actions={<Link to="/users">← All users</Link>}>
      <p className="muted small">Account facts only. Photos and videos are never shown in the console. Opening this page is recorded in the activity log.</p>
      <Loaded state={state}>
        {(d) => (
          <div className="grid2">
            <Card title={d.user.name}>
              <dl className="facts">
                <dt>Account ID</dt>
                <dd>
                  <code>{d.user.id}</code> {d.user.test && <Badge>test</Badge>}
                </dd>
                <dt>Email</dt>
                <dd>{d.user.email ?? <span className="muted">guest (not signed in)</span>}</dd>
                <dt>Sign-in methods</dt>
                <dd>{d.user.logins.join(', ') || '—'}</dd>
                <dt>Joined</dt>
                <dd>{date(d.user.createdAt)}</dd>
                <dt>Came from</dt>
                <dd>{d.attribution ? `${d.attribution.program}${d.attribution.source ? ` (${d.attribution.source})` : ''}` : 'direct'}</dd>
                {d.referral && (
                  <>
                    <dt>Invite reward</dt>
                    <dd>{d.referral}</dd>
                  </>
                )}
              </dl>
            </Card>
            <Card title="Library">
              <dl className="facts">
                <dt>Items</dt>
                <dd>
                  {n(d.media.items)} <span className="muted">· {n(d.media.photos)} photos · {n(d.media.videos)} videos</span>
                </dd>
                <dt>Lens storage used</dt>
                <dd>
                  {bytes(d.user.usedBytes)} {d.user.bonusBytes > 0 && <span className="muted">· +{bytes(d.user.bonusBytes)} bonus</span>}
                </dd>
                <dt>In their own storage</dt>
                <dd>{n(d.media.ownStorageItems)} items</dd>
                <dt>Uploading</dt>
                <dd>{n(d.media.pending)}</dd>
                <dt>Trash / archive</dt>
                <dd>
                  {n(d.media.inTrash)} / {n(d.media.archived)}
                </dd>
                <dt>Last upload</dt>
                <dd>{when(d.media.lastUploadAt)}</dd>
                <dt>Share links · albums</dt>
                <dd>
                  {n(d.sharing.links)} · {n(d.sharing.albums)}
                </dd>
              </dl>
            </Card>
            <Card title="Storage plan">
              <dl className="facts">
                <dt>Storage now</dt>
                <dd>{bytes(d.storage.quotaBytes)}</dd>
                <dt>Paid plan</dt>
                <dd>
                  {d.storage.plan ? (
                    <>
                      {d.storage.plan.id} <Badge tone={d.storage.plan.status === 'active' ? 'good' : d.storage.plan.status === 'grace' ? 'warn' : 'plain'}>{d.storage.plan.status}</Badge>
                      <div className="muted small">
                        {d.storage.plan.status === 'grace' ? `grace until ${date(d.storage.plan.graceUntil)}` : d.storage.plan.status === 'lapsed' ? `ended ${date(d.storage.plan.lapsedAt)}` : `renews ${date(d.storage.plan.periodEnd)}`}
                        {d.storage.plan.cancelled ? ' · cancelled' : ''} · {d.storage.plan.provider}
                      </div>
                    </>
                  ) : (
                    'none'
                  )}
                </dd>
                <dt>Welcome (40 GB)</dt>
                <dd>{d.storage.welcomeUntil ? `until ${date(d.storage.welcomeUntil)}` : '—'}</dd>
                <dt>Over the limit</dt>
                <dd>
                  {d.storage.overLimitSince ? (
                    <>
                      since {date(d.storage.overLimitSince)}
                      <div className="muted small">above-limit items deleted {date(d.storage.deletionAt)}</div>
                    </>
                  ) : (
                    'no'
                  )}
                </dd>
              </dl>
              {canWrite && !!d.user.email && (
                <div className="btns" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
                  <button className="btn" onClick={() => planAction('grant', { planId: 'plus50', months: 1 })}>
                    Give 1 month · 50 GB
                  </button>
                  {d.storage.plan?.status === 'active' && (
                    <button className="btn" onClick={() => planAction('payment-failed')}>
                      Mark payment failed
                    </button>
                  )}
                  {d.storage.plan && d.storage.plan.status !== 'lapsed' && (
                    <button className="btn danger" onClick={() => planAction('end')}>
                      End plan
                    </button>
                  )}
                </div>
              )}
            </Card>
            <Card title="Devices">
              {d.devices.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Signed in</th>
                      <th>Last used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.devices.map((x, i) => (
                      <tr key={i}>
                        <td>
                          {x.name} {x.web && <Badge>web</Badge>}
                        </td>
                        <td>{when(x.since)}</td>
                        <td>{when(x.lastUsedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>No signed-in devices.</Empty>
              )}
            </Card>
            <Card title="Programs">
              <dl className="facts">
                <dt>Affiliate</dt>
                <dd>{d.programs.affiliate ?? 'no'}</dd>
                <dt>Friends invited</dt>
                <dd>{n(d.programs.invites)}</dd>
                {Object.entries(d.programs.invitesByState).map(([k, v]) => (
                  <InviteRow key={k} k={k} v={v} />
                ))}
              </dl>
            </Card>
          </div>
        )}
      </Loaded>
    </Page>
  );
}

function InviteRow({ k, v }: { k: string; v: number }) {
  return (
    <>
      <dt className="sub">· {k}</dt>
      <dd>{n(v)}</dd>
    </>
  );
}
