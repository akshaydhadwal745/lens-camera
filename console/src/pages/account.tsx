import { get, post } from '../api';
import { Badge, Card, Confirm, date, Loaded, Page, useLoad, when } from '../ui';

type S = { id: string; createdAt: number; lastSeen: number; ua?: string; city?: string; current: boolean };

function browser(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}

export function Account() {
  const state = useLoad(() => get<{ sessions: S[] }>('/sessions'), []);
  return (
    <Page title="Your sessions">
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
