import { useState } from 'react';

import { get, post } from '../api';
import { Badge, Card, date, Empty, Loaded, Page, rupees, Tabs, useLoad } from '../ui';

type Affiliate = { id: string; status: string; name: string; email: string; channels?: string; audience?: string; appliedAt: number; panMasked?: string; upiMasked?: string; note?: string };

const ACTIONS: Record<string, { action: string; label: string; danger?: boolean }[]> = {
  applied: [
    { action: 'approve', label: 'Approve' },
    { action: 'reject', label: 'Reject', danger: true },
  ],
  approved: [{ action: 'suspend', label: 'Suspend', danger: true }],
  suspended: [{ action: 'reinstate', label: 'Reinstate' }],
};

export function Affiliates() {
  const [status, setStatus] = useState<'applied' | 'approved' | 'suspended' | 'rejected'>('applied');
  const state = useLoad(() => get<{ affiliates: Affiliate[] }>(`/affiliates?status=${status}`), [status]);

  async function decide(id: string, action: string) {
    const note = prompt(`Note for "${action}" (optional; saved in the audit log):`) ?? undefined;
    if (note === undefined) return;
    await post(`/affiliates/${encodeURIComponent(id)}`, { action, note }).catch((e: Error) => alert(e.message));
    state.reload();
  }

  return (
    <Page title="Affiliates">
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={setStatus}
          options={[
            { value: 'applied', label: 'Applications' },
            { value: 'approved', label: 'Approved' },
            { value: 'suspended', label: 'Suspended' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
      </div>
      <Loaded state={state}>
        {(d) =>
          d.affiliates.length ? (
            <div className="list">
              {d.affiliates.map((a) => (
                <article key={a.id} className="item">
                  <header>
                    <strong>{a.name}</strong>
                    <span className="muted small">
                      {a.email} · applied {date(a.appliedAt)}
                    </span>
                    <Badge>{a.status}</Badge>
                  </header>
                  {a.channels && <p className="msg">Channels: {a.channels}</p>}
                  {a.audience && <p className="msg">Audience: {a.audience}</p>}
                  <footer>
                    <span className="muted small">
                      UPI {a.upiMasked ?? '—'} · PAN {a.panMasked ?? '—'}
                      {a.note ? ` · note: ${a.note}` : ''}
                    </span>
                    <span className="btns">
                      {(ACTIONS[a.status] ?? []).map((x) => (
                        <button key={x.action} className={x.danger ? 'btn danger' : 'btn'} onClick={() => decide(a.id, x.action)}>
                          {x.label}
                        </button>
                      ))}
                    </span>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <Empty>No {status} affiliates.</Empty>
          )
        }
      </Loaded>
    </Page>
  );
}

type Held = { inviterId: string; friendId: string; friendName: string; reason: string; at: number };

export function Referrals() {
  const state = useLoad(() => get<{ held: Held[] }>('/referrals/held'), []);
  async function decide(friendId: string, action: 'release' | 'reject') {
    const note = prompt(`Note for "${action}" (optional):`) ?? undefined;
    if (note === undefined) return;
    await post(`/referrals/${encodeURIComponent(friendId)}`, { action, note }).catch((e: Error) => alert(e.message));
    state.reload();
  }
  return (
    <Page title="Referrals">
      <p className="muted small">Invite rewards held by the fraud checks (same phone, emulator, too many invites…). Release pays the +10 GB to both people.</p>
      <Loaded state={state}>
        {(d) =>
          d.held.length ? (
            <Card>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Friend</th>
                      <th>Why held</th>
                      <th>When</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.held.map((h) => (
                      <tr key={h.friendId}>
                        <td>{h.friendName}</td>
                        <td>{h.reason}</td>
                        <td>{date(h.at)}</td>
                        <td className="btns">
                          <button className="btn" onClick={() => decide(h.friendId, 'release')}>
                            Release
                          </button>
                          <button className="btn danger" onClick={() => decide(h.friendId, 'reject')}>
                            Reject
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Empty>No held invites.</Empty>
          )
        }
      </Loaded>
    </Page>
  );
}

type Payout = { affiliateId: string; name?: string; email?: string; upi?: string; pan?: string; grossPaise: number; tdsPaise: number; netPaise: number; status: string; reference?: string };

export function Payouts() {
  const last = new Date();
  last.setUTCDate(1);
  last.setUTCMonth(last.getUTCMonth() - 1);
  const [month, setMonth] = useState(last.toISOString().slice(0, 7));
  const [show, setShow] = useState(false);
  const state = useLoad(() => (show ? get<{ payouts: Payout[] }>(`/payouts?month=${month}`) : Promise.resolve(null)), [month, show]);

  async function run() {
    if (!confirm(`Prepare payout statements for ${month}? Approved commissions above the minimum are moved into this month’s statements.`)) return;
    const r = await post<{ payouts: unknown[] }>('/payouts/run', { month }).catch((e: Error) => (alert(e.message), null));
    if (r) alert(`${r.payouts.length} statements prepared.`);
    setShow(true);
    state.reload();
  }

  async function paid(p: Payout) {
    const reference = prompt(`UPI/bank reference for the ${rupees(p.netPaise)} transfer to ${p.name ?? p.affiliateId}:`);
    if (!reference) return;
    await post(`/payouts/${encodeURIComponent(p.affiliateId)}/${month}/paid`, { reference }).catch((e: Error) => alert(e.message));
    state.reload();
  }

  return (
    <Page title="Payouts">
      <div className="toolbar">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <button className="btn" onClick={() => setShow(true)}>
          Open payout sheet
        </button>
        <button className="btn" onClick={run}>
          Prepare statements
        </button>
      </div>
      <p className="muted small">The sheet shows full UPI IDs and PANs for the transfer, so opening it is recorded in the audit log.</p>
      {show && (
        <Loaded state={state}>
          {(d) =>
            d && d.payouts.length ? (
              <Card>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Affiliate</th>
                        <th>UPI</th>
                        <th>PAN</th>
                        <th className="num">Commission</th>
                        <th className="num">TDS</th>
                        <th className="num">To pay</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.payouts.map((p) => (
                        <tr key={p.affiliateId}>
                          <td>
                            {p.name}
                            <div className="muted small">{p.email}</div>
                          </td>
                          <td>
                            <code>{p.upi ?? '—'}</code>
                          </td>
                          <td>
                            <code>{p.pan ?? '—'}</code>
                          </td>
                          <td className="num">{rupees(p.grossPaise)}</td>
                          <td className="num">{rupees(p.tdsPaise)}</td>
                          <td className="num">
                            <strong>{rupees(p.netPaise)}</strong>
                          </td>
                          <td>
                            <Badge tone={p.status === 'paid' ? 'good' : 'warn'}>{p.status}</Badge>
                            {p.reference && <div className="muted small">{p.reference}</div>}
                          </td>
                          <td>
                            {p.status === 'due' && (
                              <button className="btn" onClick={() => paid(p)}>
                                Mark paid
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : (
              <Empty>No payouts for {month}.</Empty>
            )
          }
        </Loaded>
      )}
    </Page>
  );
}
