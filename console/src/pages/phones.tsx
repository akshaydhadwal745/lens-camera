import { useState } from 'react';

import { get } from '../api';
import { Breakdown, Card, Empty, Loaded, n, Page, Stat, useLoad } from '../ui';

type Count = { label: string; count: number }[];
type Share = { yes: number; known: number };
type Phones = {
  month: string;
  phones: number;
  models: Count;
  brands: Count;
  android: Count;
  ram: Count;
  tiers: Count;
  cameraLevel: Count;
  chips: Count;
  builds: Count;
  features: Record<string, Share>;
};

const FEATURES: Record<string, string> = {
  bits64: '64-bit',
  ois: 'Optical stabilisation',
  flash: 'Flash',
  video4k: '4K video',
  hdrVideo: 'HDR video',
  makerNight: 'Maker Night mode',
  slowMotion: 'Slow motion',
  slowMotionCamera2: 'Slow motion (Camera2)',
  lowLightBoost: 'Low-light boost',
  concurrentCameras: 'Front + back at once',
};

function months() {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

export function Phones() {
  const [month, setMonth] = useState(months()[0]);
  const state = useLoad(() => get<Phones>(`/phones?month=${month}`), [month]);
  return (
    <Page
      title="Phones"
      actions={
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months().map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      }
    >
      <p className="muted small">From the anonymous camera report each phone sends once a month. Counts only: the phone ID changes every month and isn’t linked to an account.</p>
      <Loaded state={state}>
        {(p) =>
          p.phones ? (
            <>
              <div className="stats">
                <Stat label="Phones this month" value={n(p.phones)} />
                <Stat label="Top model" value={p.models[0]?.label ?? '—'} sub={p.models[0] ? `${n(p.models[0].count)} phones` : undefined} />
                <Stat label="Top Android" value={p.android[0]?.label ?? '—'} />
              </div>
              <div className="grid2">
                <Card title="Models">
                  <Breakdown rows={p.models} total={p.phones} />
                </Card>
                <Card title="Camera features">
                  <ul className="breakdown">
                    {Object.entries(FEATURES).map(([k, label]) => {
                      const f = p.features[k] ?? { yes: 0, known: 0 };
                      const pct = f.known ? Math.round((f.yes / f.known) * 100) : 0;
                      return (
                        <li key={k}>
                          <span className="b-label">{label}</span>
                          <span className="b-track">
                            <span className="b-fill" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="b-num">{f.known ? `${pct}%` : '—'}</span>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
                <Card title="Android">
                  <Breakdown rows={p.android} total={p.phones} />
                </Card>
                <Card title="Memory">
                  <Breakdown rows={p.ram} total={p.phones} />
                </Card>
                <Card title="Brands">
                  <Breakdown rows={p.brands} total={p.phones} />
                </Card>
                <Card title="Lens camera tier">
                  <Breakdown rows={p.tiers} total={p.phones} />
                </Card>
                <Card title="Camera hardware level">
                  <Breakdown rows={p.cameraLevel} total={p.phones} />
                </Card>
                <Card title="App builds">
                  <Breakdown rows={p.builds} total={p.phones} />
                </Card>
              </div>
            </>
          ) : (
            <Empty>No phone reports for {p.month}.</Empty>
          )
        }
      </Loaded>
    </Page>
  );
}
