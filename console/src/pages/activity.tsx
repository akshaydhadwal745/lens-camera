import { useState } from 'react';

import { get } from '../api';
import { Badge, Card, date, Empty, Loaded, Page, useLoad } from '../ui';

type Event = { entity: string; action: string; actor: string; at: number; data?: Record<string, unknown> };

const LABELS: Record<string, string> = {
  'console.login': 'Signed in',
  'console.logout': 'Signed out',
  'console.login.denied': 'Sign-in refused (not on the team)',
  'console.mfa.failed': 'Wrong authenticator code',
  'console.mfa.locked': 'Too many wrong codes',
  'console.mfa.enrolled': 'Set up authenticator',
  'console.mfa.reset': 'Authenticator reset',
  'console.sessions.ended': 'Sessions ended',
  'console.user.viewed': 'Opened an account',
  'team.role-set': 'Team role set',
  'team.removed': 'Removed from team',
  'feedback.done': 'Feedback handled',
  'contact.done': 'Message handled',
};

const tone = (a: string) => (/denied|failed|locked/.test(a) ? 'bad' : /reset|removed|ended/.test(a) ? 'warn' : 'plain');

export function Activity() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filter, setFilter] = useState('');
  const state = useLoad(() => get<{ events: Event[] }>(`/activity?month=${month}`), [month]);
  return (
    <Page title="Activity log" actions={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}>
      <p className="muted small">Every console sign-in, failed code, team change and admin action. Also written to the locked audit store, where it can’t be edited or deleted.</p>
      <div className="toolbar">
        <input className="search" placeholder="Filter by person or action" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <Loaded state={state}>
        {(d) => {
          const f = filter.trim().toLowerCase();
          const rows = d.events.filter((e) => !f || `${e.actor} ${e.entity} ${e.action} ${LABELS[e.action] ?? ''}`.toLowerCase().includes(f));
          return rows.length ? (
            <Card>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>What</th>
                      <th>About</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e, i) => (
                      <tr key={i}>
                        <td className="nowrap">{date(e.at)}</td>
                        <td>{e.actor.replace(/^console:/, '')}</td>
                        <td>
                          <Badge tone={tone(e.action)}>{LABELS[e.action] ?? e.action}</Badge>
                          {e.data?.city ? <span className="muted small"> · {String(e.data.city)}</span> : null}
                        </td>
                        <td className="muted small">{e.entity.replace(/^console:/, '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Empty>No activity{f ? ' matches' : ` in ${month}`}.</Empty>
          );
        }}
      </Loaded>
    </Page>
  );
}
