import { useState } from 'react';

import { get } from '../api';
import { Badge, bytes, Card, DailyBars, Link, Loaded, n, Page, Stat, Tabs, useLoad, when } from '../ui';

type Series = { day: string; count: number }[];
type Overview = {
  at: number;
  cached: boolean;
  users: { total: number; signedIn: number; guests: number; new1d: number; new7d: number; new30d: number; invited: number; viaAffiliate: number; testAccountsHidden: number; signups: Series };
  active: { d1: number; d7: number; d30: number };
  media: { items: number; photos: number; videos: number; pending: number; inTrash: number; inOwnStorage: number; lensBytes: number; ownStorageBytes: number; uploads: Series; uploads1d: number; uploads7d: number };
  storage: { accountedBytes: number; bonusBytes: number; bucketBytes: number | null };
  sharing: { shareRequests: number; contacts: number; albums: number; sharedAlbumMembers: number; links: number; linksActive: number; events: number; recaps: number };
  programs: { referrals: number; referralsByState: Record<string, number>; affiliates: number; affiliatesByStatus: Record<string, number> };
  todo: { feedback: number; reports: number; inbox: number; affiliatesToReview: number; referralsHeld: number };
  table: { items: number };
};

export function Overview() {
  const [refresh, setRefresh] = useState(0);
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const state = useLoad(() => get<Overview>(`/overview${refresh ? '?refresh=1' : ''}`), [refresh]);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <Page
      title="Overview"
      actions={
        <>
          {state.data && <span className="muted small">Updated {when(state.data.at)}</span>}
          <button className="btn" disabled={state.loading} onClick={() => setRefresh((r) => r + 1)}>
            {state.loading ? 'Loading…' : 'Refresh'}
          </button>
        </>
      }
    >
      <Loaded state={state}>
        {(o) => (
          <>
            <TodoStrip todo={o.todo} />
            <div className="stats">
              <Stat label="Users" value={n(o.users.total)} sub={`${n(o.users.signedIn)} signed in · ${n(o.users.guests)} guests`} />
              <Stat label="New users" value={n(o.users.new7d)} sub={`${n(o.users.new1d)} today · ${n(o.users.new30d)} in 30 days`} />
              <Stat label="Active" value={n(o.active.d7)} sub={`${n(o.active.d1)} today · ${n(o.active.d30)} in 30 days`} />
              <Stat label="Uploads" value={n(o.media.uploads7d)} sub={`last 7 days · ${n(o.media.uploads1d)} today`} />
              <Stat label="Items in Lens" value={n(o.media.items)} sub={`${n(o.media.photos)} photos · ${n(o.media.videos)} videos`} />
              <Stat label="Storage" value={bytes(o.storage.bucketBytes ?? o.storage.accountedBytes)} sub={`${bytes(o.media.lensBytes)} originals in Lens · ${bytes(o.media.ownStorageBytes)} in users’ own storage`} />
            </div>

            <div className="row-head">
              <h2>Trends</h2>
              <Tabs
                value={days}
                onChange={setDays}
                options={[
                  { value: '7', label: '7 days' },
                  { value: '30', label: '30 days' },
                  { value: '90', label: '90 days' },
                ]}
              />
            </div>
            <div className="grid2">
              <Card>
                <DailyBars data={o.users.signups} days={Number(days)} label="New users" />
              </Card>
              <Card>
                <DailyBars data={o.media.uploads} days={Number(days)} label="Uploads" />
              </Card>
            </div>

            <div className="grid3">
              <Card title="Users">
                <dl className="facts">
                  <dt>Signed in</dt>
                  <dd>
                    {n(o.users.signedIn)} <span className="muted">({pct(o.users.signedIn, o.users.total)})</span>
                  </dd>
                  <dt>Guests</dt>
                  <dd>{n(o.users.guests)}</dd>
                  <dt>Came from an invite</dt>
                  <dd>{n(o.users.invited)}</dd>
                  <dt>Came from an affiliate</dt>
                  <dd>{n(o.users.viaAffiliate)}</dd>
                  <dt>Active in 30 days</dt>
                  <dd>
                    {n(o.active.d30)} <span className="muted">({pct(o.active.d30, o.users.total)})</span>
                  </dd>
                </dl>
              </Card>
              <Card title="Media">
                <dl className="facts">
                  <dt>Photos</dt>
                  <dd>{n(o.media.photos)}</dd>
                  <dt>Videos</dt>
                  <dd>{n(o.media.videos)}</dd>
                  <dt>Uploading now</dt>
                  <dd>{n(o.media.pending)}</dd>
                  <dt>In users’ own storage</dt>
                  <dd>{n(o.media.inOwnStorage)}</dd>
                  <dt>In trash</dt>
                  <dd>{n(o.media.inTrash)}</dd>
                </dl>
              </Card>
              <Card title="Sharing">
                <dl className="facts">
                  <dt>Share requests</dt>
                  <dd>{n(o.sharing.shareRequests)}</dd>
                  <dt>Contacts made</dt>
                  <dd>{n(o.sharing.contacts)}</dd>
                  <dt>Albums</dt>
                  <dd>
                    {n(o.sharing.albums)} <span className="muted">· {n(o.sharing.sharedAlbumMembers)} shared members</span>
                  </dd>
                  <dt>Share links</dt>
                  <dd>
                    {n(o.sharing.links)} <span className="muted">· {n(o.sharing.linksActive)} active</span>
                  </dd>
                  <dt>Event albums</dt>
                  <dd>{n(o.sharing.events)}</dd>
                  <dt>Recaps</dt>
                  <dd>{n(o.sharing.recaps)}</dd>
                </dl>
              </Card>
              <Card title="Storage">
                <dl className="facts">
                  <dt>Media bucket (AWS)</dt>
                  <dd>{bytes(o.storage.bucketBytes)}</dd>
                  <dt>Counted against users</dt>
                  <dd>{bytes(o.storage.accountedBytes)}</dd>
                  <dt>Bonus storage given</dt>
                  <dd>{bytes(o.storage.bonusBytes)}</dd>
                </dl>
                <p className="muted small">The bucket also holds previews, streams and trash, so it is larger than what users are counted for.</p>
              </Card>
              <Card title="Programs">
                <dl className="facts">
                  <dt>Invites</dt>
                  <dd>{n(o.programs.referrals)}</dd>
                  {Object.entries(o.programs.referralsByState).map(([k, v]) => (
                    <FactRow key={k} k={`· ${k}`} v={v} />
                  ))}
                  <dt>Affiliates</dt>
                  <dd>{n(o.programs.affiliates)}</dd>
                  {Object.entries(o.programs.affiliatesByStatus).map(([k, v]) => (
                    <FactRow key={k} k={`· ${k}`} v={v} />
                  ))}
                </dl>
              </Card>
              <Card title="About these numbers">
                <p className="muted small">
                  Real accounts only: {n(o.users.testAccountsHidden)} test accounts from automated checks are left out. “Active” means the app or website was used. Counted from {n(o.table.items)} database records;
                  refreshed every 10 minutes. No photo, name or message is read to make this page.
                </p>
              </Card>
            </div>
          </>
        )}
      </Loaded>
    </Page>
  );
}

function FactRow({ k, v }: { k: string; v: number }) {
  return (
    <>
      <dt className="sub">{k}</dt>
      <dd>{n(v)}</dd>
    </>
  );
}

function TodoStrip({ todo }: { todo: Overview['todo'] }) {
  const items = [
    { n: todo.reports, label: 'reports', to: '/feedback?kind=report', tone: 'bad' as const },
    { n: todo.feedback, label: 'feedback', to: '/feedback', tone: 'warn' as const },
    { n: todo.inbox, label: 'messages', to: '/inbox', tone: 'warn' as const },
    { n: todo.affiliatesToReview, label: 'affiliate applications', to: '/affiliates', tone: 'warn' as const },
    { n: todo.referralsHeld, label: 'held invites', to: '/referrals', tone: 'warn' as const },
  ].filter((i) => i.n > 0);
  if (!items.length) return <div className="todo clear">Nothing waiting for review.</div>;
  return (
    <div className="todo">
      <span className="muted">Waiting:</span>
      {items.map((i) => (
        <Link key={i.label} to={i.to}>
          <Badge tone={i.tone}>
            {i.n} {i.label}
          </Badge>
        </Link>
      ))}
    </div>
  );
}
