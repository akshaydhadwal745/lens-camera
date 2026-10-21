import { ReactNode, useCallback, useEffect, useState } from 'react';

// ---------- navigation (no router library: a few paths, history API) ----------

export function navigate(to: string) {
  if (location.pathname + location.search === to) return;
  history.pushState(null, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath() {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const f = () => setPath(location.pathname + location.search);
    addEventListener('popstate', f);
    return () => removeEventListener('popstate', f);
  }, []);
  return path;
}

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ---------- data loading ----------

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    run().then(
      (data) => setState({ data, loading: false }),
      (e: Error) => setState({ error: e.message, loading: false }),
    );
  }, [run]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

export function Loaded<T>({ state, children }: { state: { data?: T; error?: string; loading: boolean }; children: (d: T) => ReactNode }) {
  if (state.error) return <div className="notice error">{state.error}</div>;
  if (state.data === undefined) return <div className="muted pad">Loading…</div>;
  return <>{children(state.data)}</>;
}

// ---------- formatting ----------

export const n = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toLocaleString('en-IN'));

export function bytes(b: number | null | undefined) {
  if (b === null || b === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function when(t: number | null | undefined) {
  if (!t) return '—';
  const d = Date.now() - t;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  if (d < 30 * 86_400_000) return `${Math.round(d / 86_400_000)} d ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const date = (t: number | null | undefined) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const rupees = (paise: number | null | undefined) => (paise === null || paise === undefined ? '—' : `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);

// ---------- pieces ----------

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Lens Console`;
  }, [title]);
  return (
    <section className="page">
      <header className="page-head">
        <h1>{title}</h1>
        <div className="actions">{actions}</div>
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub !== undefined && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'tab on' : 'tab'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'good' | 'warn' | 'bad' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Daily counts as bars (last N days), with the total and the busiest day. */
export function DailyBars({ data, days = 30, label }: { data: { day: string; count: number }[]; days?: number; label: string }) {
  const rows = data.slice(-days);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  const [hover, setHover] = useState<number | null>(null);
  const w = 100 / rows.length;
  const shown = hover === null ? null : rows[hover];
  return (
    <figure className="chart">
      <figcaption>
        <span>
          {label}: <strong>{n(total)}</strong> in {rows.length} days
        </span>
        <span className="muted">{shown ? `${new Date(shown.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${n(shown.count)}` : `peak ${n(max === 1 && total === 0 ? 0 : max)}`}</span>
      </figcaption>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${label} per day`} onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => {
          const h = (r.count / max) * 38;
          return (
            <g key={r.day} onMouseEnter={() => setHover(i)}>
              <rect x={i * w} y={0} width={w} height={40} className="hit" />
              <rect x={i * w + w * 0.15} y={40 - Math.max(h, r.count ? 0.8 : 0.3)} width={w * 0.7} height={Math.max(h, r.count ? 0.8 : 0.3)} className={hover === i ? 'bar on' : 'bar'} rx={0.4} />
            </g>
          );
        })}
      </svg>
      <div className="axis">
        <span>{rows[0] && new Date(rows[0].day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        <span>today</span>
      </div>
    </figure>
  );
}

/** Horizontal bars for "label → count" lists. */
export function Breakdown({ rows, total }: { rows: { label: string; count: number }[]; total?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const sum = total ?? rows.reduce((s, r) => s + r.count, 0);
  if (!rows.length) return <Empty>No data yet</Empty>;
  return (
    <ul className="breakdown">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="b-label">{r.label}</span>
          <span className="b-track">
            <span className="b-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="b-num">
            {n(r.count)} <span className="muted">{sum ? `${Math.round((r.count / sum) * 100)}%` : ''}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Confirm({ text, onYes, children, danger }: { text: string; onYes: () => void | Promise<void>; children: ReactNode; danger?: boolean }) {
  return (
    <button
      className={danger ? 'btn danger' : 'btn'}
      onClick={() => {
        if (confirm(text)) void onYes();
      }}
    >
      {children}
    </button>
  );
}
