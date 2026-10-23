import { useState } from 'react';

import { get, post } from '../api';
import { Badge, Card, Confirm, date, Loaded, Page, useLoad, when } from '../ui';

type S = { id: string; createdAt: number; lastSeen: number; ua?: string; city?: string; current: boolean };

function browser(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}

function BackupCodes() {
  const state = useLoad(() => get<{ left: number; at?: number }>('/auth/backup-codes'), []);
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <Card
      title="Backup codes"
      actions={
        <Confirm text="Make 10 new backup codes? The old ones stop working." onYes={() => post<{ codes: string[] }>('/auth/backup-codes').then((r) => (setCodes(r.codes), state.reload()))}>
          Make new codes
        </Confirm>
      }
    >
      <p className="muted small">Each code works once instead of your authenticator code, if you lose your phone.</p>
      <Loaded state={state}>
        {(d) => (
          <p>
            {d.left > 0 ? <Badge tone={d.left > 3 ? 'good' : 'warn'}>{d.left} left</Badge> : <Badge tone="warn">none: make some now</Badge>}
            {d.at ? <span className="muted small"> · made {date(d.at)}</span> : null}
          </p>
        )}
      </Loaded>
      {codes && (
        <>
          <p className="notice">Save these now: they are not shown again.</p>
          <pre className="secret codes">{codes.join('\n')}</pre>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>
            Copy
          </button>
        </>
      )}
    </Card>
  );
}

export function Account() {
  const state = useLoad(() => get<{ sessions: S[] }>('/sessions'), []);
  return (
    <Page title="Your account">
      <BackupCodes />
      <p className="muted small">Where you’re signed in to the console. Sessions end after 30 minutes without activity and always after 12 hours.</p>
      <Loaded state={state}>
        {(d) => (
          <Card
            actions={
              d.sessions.length > 1 && (
                <Confirm text="Sign out all your other sessions?" onYes={() => post('/sessions/end', {}).then(state.reload)}>
                  Sign out other sessions
                </Confirm>
              )
            }
          >
            <table>
              <thead>
                <tr>
                  <th>Browser</th>
                  <th>Place</th>
                  <th>Signed in</th>
                  <th>Last active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {browser(s.ua)} {s.current && <Badge tone="good">this one</Badge>}
                    </td>
                    <td>{s.city ?? '—'}</td>
                    <td>{date(s.createdAt)}</td>
                    <td>{when(s.lastSeen)}</td>
                    <td>
                      {!s.current && (
                        <button className="btn" onClick={() => post('/sessions/end', { id: s.id }).then(state.reload)}>
                          Sign out
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Loaded>
    </Page>
  );
}
