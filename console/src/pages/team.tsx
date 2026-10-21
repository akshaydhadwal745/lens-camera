import { FormEvent, useState } from 'react';

import { api, get, post } from '../api';
import { Badge, Card, Confirm, date, Loaded, Page, useLoad } from '../ui';

type Member = { email: string; role: string; fixed: boolean; addedBy?: string; at?: number; authenticator: boolean; sessions: number };
type RoleInfo = { role: string; permissions: string[] };

const ABOUT: Record<string, string> = {
  admin: 'Everything except the team',
  support: 'Users, feedback, reports, inbox, phones, health',
  finance: 'Affiliates, referrals, payouts, costs, audit',
  viewer: 'Overview, phones and health (read only)',
};

export function Team({ me }: { me: string }) {
  const state = useLoad(() => get<{ team: Member[]; roles: RoleInfo[] }>('/team'), []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('support');
  const [error, setError] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('PUT', '/team', { email, role });
      setEmail('');
      state.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function change(m: Member, to: string) {
    await api('PUT', '/team', { email: m.email, role: to }).catch((e: Error) => alert(e.message));
    state.reload();
  }

  return (
    <Page title="Team">
      <p className="muted small">
        People who can open the console. Each signs in with their own Google account plus an authenticator code. Owners are set in the server configuration and can’t be removed here.
      </p>
      <Card title="Add someone">
        <form className="toolbar" onSubmit={add}>
          <input className="search" type="email" required placeholder="Their Google email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            {Object.keys(ABOUT).map((r) => (
              <option key={r} value={r}>
                {r} — {ABOUT[r]}
              </option>
            ))}
          </select>
          <button className="btn primary">Add</button>
        </form>
        {error && <div className="notice error">{error}</div>}
      </Card>
      <Loaded state={state}>
        {(d) => (
          <Card>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th>Authenticator</th>
                    <th>Signed in now</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.team.map((m) => (
                    <tr key={m.email}>
                      <td>
                        {m.email} {m.email === me && <Badge>you</Badge>}
                      </td>
                      <td>
                        {m.fixed ? (
                          <Badge tone="good">owner</Badge>
                        ) : (
                          <select value={m.role} onChange={(e) => change(m, e.target.value)} aria-label={`Role of ${m.email}`}>
                            {Object.keys(ABOUT).map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>{m.authenticator ? <Badge tone="good">set up</Badge> : <Badge tone="warn">at first sign-in</Badge>}</td>
                      <td>{m.sessions || '—'}</td>
                      <td className="muted small">{m.at ? `${date(m.at)} by ${m.addedBy}` : 'configuration'}</td>
                      <td className="btns">
                        {m.email !== me && m.sessions > 0 && (
                          <Confirm text={`Sign ${m.email} out everywhere?`} onYes={() => post(`/team/${encodeURIComponent(m.email)}/sign-out`, { resetAuthenticator: false }).then(state.reload)}>
                            Sign out
                          </Confirm>
                        )}
                        {m.email !== me && m.authenticator && (
                          <Confirm
                            text={`Reset ${m.email}'s authenticator? They will be signed out and must set up a new one at the next sign-in. Use this when they lost their phone.`}
                            onYes={() => post(`/team/${encodeURIComponent(m.email)}/sign-out`, { resetAuthenticator: true }).then(state.reload)}
                          >
                            Reset authenticator
                          </Confirm>
                        )}
                        {!m.fixed && (
                          <Confirm danger text={`Remove ${m.email}? Their access ends immediately.`} onYes={() => api('DELETE', `/team/${encodeURIComponent(m.email)}`).then(state.reload)}>
                            Remove
                          </Confirm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Loaded>
    </Page>
  );
}
