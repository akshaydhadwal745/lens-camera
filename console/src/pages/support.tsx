import { useState } from 'react';

import { get, post } from '../api';
import { Badge, date, Empty, Loaded, Page, Tabs, useLoad } from '../ui';

type FeedbackRow = {
  id: string;
  reference: string;
  kind: string;
  source?: string;
  rating?: number;
  message: string;
  email?: string;
  accountEmail?: string;
  device?: Record<string, unknown>;
  at: number;
  status: string;
  emailStatus?: string;
  attachments?: number;
};

const KINDS = [
  { value: '', label: 'All' },
  { value: 'report', label: 'Reports' },
  { value: 'issue', label: 'Problems' },
  { value: 'idea', label: 'Ideas' },
  { value: 'review', label: 'Reviews' },
  { value: 'other', label: 'Other' },
];

export function Feedback({ canWrite }: { canWrite: boolean }) {
  const params = new URLSearchParams(location.search);
  const [status, setStatus] = useState<'new' | 'done'>('new');
  const [kind, setKind] = useState(params.get('kind') ?? '');
  const [tests, setTests] = useState(false);
  const state = useLoad(() => get<{ feedback: FeedbackRow[] }>(`/feedback?status=${status}${kind ? `&kind=${kind}` : ''}${tests ? '&tests=1' : ''}`), [status, kind, tests]);

  async function done(id: string) {
    await post(`/feedback/${encodeURIComponent(id)}/done`).catch((e: Error) => alert(e.message));
    state.reload();
  }

  return (
    <Page title="Feedback & reports">
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={setStatus}
          options={[
            { value: 'new', label: 'Open' },
            { value: 'done', label: 'Handled' },
          ]}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} /> Show test entries
        </label>
      </div>
      <Loaded state={state}>
        {(d) =>
          d.feedback.length ? (
            <div className="list">
              {d.feedback.map((f) => (
                <article key={f.id} className="item">
                  <header>
                    <Badge tone={f.kind === 'report' ? 'bad' : f.kind === 'issue' ? 'warn' : 'plain'}>{f.kind}</Badge>
                    {f.rating !== undefined && <span>{'★'.repeat(f.rating)}</span>}
                    <span className="muted small">
                      {f.reference} · {date(f.at)}
                      {f.source ? ` · ${f.source}` : ''}
                    </span>
                  </header>
                  <p className="msg">{f.message}</p>
                  {!!f.attachments && <Screenshots id={f.id} count={f.attachments} />}
                  <footer>
                    <span className="muted small">
                      {f.email ? `Reply to: ${f.email}` : f.accountEmail ? `Account: ${f.accountEmail}` : 'No reply address'}
                      {f.device ? ` · ${[f.device.model, f.device.os, f.device.osVersion, f.device.build].filter(Boolean).join(' ')}` : ''}
                      {f.emailStatus && f.emailStatus !== 'sent' ? ` · email ${f.emailStatus}` : ''}
                    </span>
                    {canWrite && f.status === 'new' && (
                      <button className="btn" onClick={() => done(f.id)}>
                        Mark handled
                      </button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <Empty>{status === 'new' ? 'Nothing open. 🎉' : 'Nothing handled yet.'}</Empty>
          )
        }
      </Loaded>
    </Page>
  );
}

/** Hidden until asked for: opening them is recorded in the activity log. */
function Screenshots({ id, count }: { id: string; count: number }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn ghost attach" onClick={() => setOpen(true)}>
        📎 {count} screenshot{count > 1 ? 's' : ''} · show
      </button>
    );
  return (
    <div className="shots">
      {Array.from({ length: count }, (_, i) => {
        const src = `/api/feedback/${encodeURIComponent(id)}/files/${i}`;
        return (
          <a key={i} href={src} target="_blank" rel="noopener">
            <img src={src} alt={`Screenshot ${i + 1}`} loading="lazy" />
          </a>
        );
      })}
    </div>
  );
}

type Message = { id: string; reference: string; name: string; email: string; topic: string; message: string; at: number; status: string };

export function Inbox({ canWrite }: { canWrite: boolean }) {
  const [status, setStatus] = useState<'new' | 'done'>('new');
  const state = useLoad(() => get<{ messages: Message[] }>(`/inbox?status=${status}`), [status]);

  async function done(id: string) {
    await post(`/inbox/${encodeURIComponent(id)}/done`).catch((e: Error) => alert(e.message));
    state.reload();
  }

  return (
    <Page title="Inbox">
      <p className="muted small">Messages from the website contact form.</p>
      <div className="toolbar">
        <Tabs
          value={status}
          onChange={setStatus}
          options={[
            { value: 'new', label: 'Open' },
            { value: 'done', label: 'Handled' },
          ]}
        />
      </div>
      <Loaded state={state}>
        {(d) =>
          d.messages.length ? (
            <div className="list">
              {d.messages.map((m) => (
                <article key={m.id} className="item">
                  <header>
                    <Badge tone={m.topic === 'report' || m.topic === 'grievance' ? 'bad' : m.topic === 'delete-account' || m.topic === 'privacy' ? 'warn' : 'plain'}>{m.topic}</Badge>
                    <strong>{m.name}</strong>
                    <span className="muted small">
                      {m.reference} · {date(m.at)}
                    </span>
                  </header>
                  <p className="msg">{m.message}</p>
                  <footer>
                    <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: your message (${m.reference})`)}`}>{m.email}</a>
                    {canWrite && m.status === 'new' && (
                      <button className="btn" onClick={() => done(m.id)}>
                        Mark handled
                      </button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <Empty>{status === 'new' ? 'Inbox zero. 🎉' : 'Nothing handled yet.'}</Empty>
          )
        }
      </Loaded>
    </Page>
  );
}
