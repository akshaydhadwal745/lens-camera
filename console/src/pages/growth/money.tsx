// Campaigns, spend and unit economics (CAC, cost per activated user, ROI).
import { useState } from "react";

import { api, get } from "../../api";
import { Card, Empty, Loaded, Stat, useLoad } from "../../ui";
import {
  can,
  CardTable,
  Chip,
  CopyButton,
  Person,
  shortDate,
  type Workspace,
} from "./shared";

type Econ = {
  spend: number;
  costPerVisit: number | null;
  cac: number | null;
  costPerActivated: number | null;
  costPerPaying: number | null;
  estMonthlyRevenue: number;
  roi: number | null;
  paybackMonths: number | null;
};
type Campaign = {
  id: string;
  name: string;
  channel: string;
  medium: string;
  goal: string;
  start: string;
  end: string;
  budget: number;
  landingPage: string;
  owner: string;
  status: string;
  notes: string;
  code: string;
  link: string;
  outcomes: {
    visits: number;
    installs: number;
    backedUp: number;
    signedIn: number;
    paying: number;
  };
  economics: Econ;
};
type Spend = {
  id: string;
  date: string;
  amount: number;
  category: string;
  campaignId: string;
  note: string;
  by: string;
};
type Money = {
  campaigns: Campaign[];
  spend: Spend[];
  months: ({
    month: string;
    installs: number;
    backedUp: number;
    paying: number;
  } & Econ)[];
  plusPrice: number;
};

const CHANNELS = [
  "google-ads",
  "meta-ads",
  "instagram",
  "youtube",
  "reddit",
  "whatsapp",
  "influencer",
  "partner",
  "email",
  "event",
  "print",
  "other",
];
const CATEGORIES = [
  "ads",
  "influencers",
  "events-and-print",
  "tools",
  "content",
  "other",
];
const inr = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function MoneyPage({ ws }: { ws: Workspace }) {
  const [n, setN] = useState(0);
  const state = useLoad(() => get<Money>("/growth/money"), [n]);
  const [edit, setEdit] = useState<Campaign | "new" | null>(null);
  const [spendFor, setSpendFor] = useState<string | null>(null);
  const reload = () => setN((x) => x + 1);
  return (
    <Loaded state={state}>
      {(m) => {
        const thisMonth = new Date().toISOString().slice(0, 7);
        const cur = m.months.find((x) => x.month === thisMonth);
        const totalSpend = m.spend.reduce((a, s) => a + s.amount, 0);
        return (
          <>
            <div className="stats">
              <Stat
                label="Spend this month"
                value={inr(
                  m.spend
                    .filter((s) => s.date.startsWith(thisMonth))
                    .reduce((a, s) => a + s.amount, 0),
                )}
                sub={`${inr(totalSpend)} all time`}
              />
              <Stat
                label="Cost per install, this month"
                value={inr(cur?.cac ?? null)}
                sub={`${cur?.installs ?? 0} installs`}
              />
              <Stat
                label="Cost per activated user"
                value={inr(cur?.costPerActivated ?? null)}
                sub="activated = backed up a photo"
              />
              <Stat
                label="Live campaigns"
                value={m.campaigns.filter((c) => c.status === "live").length}
                sub={`${m.campaigns.length} in total`}
              />
            </div>
            <Card
              title="Campaigns"
              actions={
                <span className="btns">
                  {can(ws, "growth.write") && (
                    <button className="btn" onClick={() => setSpendFor("")}>
                      + Log spend
                    </button>
                  )}
                  {can(ws, "growth.contribute") && (
                    <button className="btn" onClick={() => setEdit("new")}>
                      + New campaign
                    </button>
                  )}
                </span>
              }
            >
              {m.campaigns.length ? (
                <CardTable>
                  <table>
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th>Dates</th>
                        <th className="num">Budget</th>
                        <th className="num">Spent</th>
                        <th className="num">Visits</th>
                        <th className="num">Installs</th>
                        <th className="num">Activated</th>
                        <th className="num">Paying</th>
                        <th className="num">Cost / install</th>
                        <th className="num">Cost / activated</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {m.campaigns.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <button
                              className="gw-linkbtn"
                              onClick={() => setEdit(c)}
                            >
                              {c.name}
                            </button>
                            <div className="muted small">
                              {c.channel}{" "}
                              <Chip
                                tone={
                                  c.status === "live"
                                    ? "good"
                                    : c.status === "planned"
                                      ? "acc"
                                      : "plain"
                                }
                              >
                                {c.status}
                              </Chip>
                            </div>
                          </td>
                          <td className="small muted">
                            {shortDate(c.start) || "—"} →{" "}
                            {shortDate(c.end) || "—"}
                          </td>
                          <td className="num">{inr(c.budget || null)}</td>
                          <td className="num">{inr(c.economics.spend)}</td>
                          <td className="num">{c.outcomes.visits}</td>
                          <td className="num">{c.outcomes.installs}</td>
                          <td className="num">{c.outcomes.backedUp}</td>
                          <td className="num">{c.outcomes.paying}</td>
                          <td className="num">{inr(c.economics.cac)}</td>
                          <td className="num">
                            {inr(c.economics.costPerActivated)}
                          </td>
                          <td>
                            {can(ws, "growth.write") && (
                              <button
                                className="btn ghost small"
                                onClick={() => setSpendFor(c.id)}
                              >
                                + spend
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardTable>
              ) : (
                <Empty>
                  No campaigns yet. A campaign gives you a tagged link: share it
                  in posts, ads, partner pages or QR cards, and visits, installs
                  and activation are counted for it.
                </Empty>
              )}
              <p className="muted small">
                Visits are counted by our website analytics from the campaign's
                link (last 90 days). Installs, activation and paying users come
                from the Play install referrer, so they count from the Play
                launch. Revenue and ROI are estimates: paying users ×{" "}
                {inr(m.plusPrice)} a month.
              </p>
            </Card>
            <div className="grid2">
              <Card title="By month">
                {m.months.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th className="num">Spend</th>
                          <th className="num">Installs</th>
                          <th className="num">Activated</th>
                          <th className="num">Paying</th>
                          <th className="num">Cost / install</th>
                          <th className="num">Est. ROI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.months
                          .slice()
                          .reverse()
                          .map((x) => (
                            <tr key={x.month}>
                              <td>{x.month}</td>
                              <td className="num">{inr(x.spend)}</td>
                              <td className="num">{x.installs}</td>
                              <td className="num">{x.backedUp}</td>
                              <td className="num">{x.paying}</td>
                              <td className="num">{inr(x.cac)}</td>
                              <td className="num">
                                {x.roi === null
                                  ? "—"
                                  : `${Math.round(x.roi * 100)}%`}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>Monthly numbers appear as installs arrive.</Empty>
                )}
              </Card>
              <Card title="Spend log">
                {m.spend.length ? (
                  <ul className="gw-list">
                    {m.spend.slice(0, 30).map((s) => (
                      <li key={s.id}>
                        <strong>{inr(s.amount)}</strong> · {shortDate(s.date)} ·{" "}
                        {s.category}
                        {s.campaignId
                          ? ` · ${m.campaigns.find((c) => c.id === s.campaignId)?.name ?? "a deleted campaign"}`
                          : ""}
                        {s.note ? (
                          <span className="muted small"> · {s.note}</span>
                        ) : null}{" "}
                        {can(ws, "growth.write") && (
                          <button
                            className="gw-linkbtn bad small"
                            onClick={() =>
                              confirm(
                                `Remove ${inr(s.amount)} spent on ${shortDate(s.date)}?`,
                              ) &&
                              void api("DELETE", `/growth/spend/${s.id}`).then(
                                reload,
                              )
                            }
                          >
                            remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>
                    No spend logged. Everything so far has been free (organic).
                  </Empty>
                )}
              </Card>
            </div>
            {edit && (
              <CampaignForm
                ws={ws}
                c={edit === "new" ? undefined : edit}
                onDone={() => (setEdit(null), reload())}
              />
            )}
            {spendFor !== null && (
              <SpendForm
                campaigns={m.campaigns}
                campaignId={spendFor}
                onDone={() => (setSpendFor(null), reload())}
              />
            )}
          </>
        );
      }}
    </Loaded>
  );
}

function CampaignForm({
  ws,
  c,
  onDone,
}: {
  ws: Workspace;
  c?: Campaign;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    name: c?.name ?? "",
    channel: c?.channel ?? "instagram",
    medium: c?.medium ?? "social",
    goal: c?.goal ?? "",
    start: c?.start ?? "",
    end: c?.end ?? "",
    budget: String(c?.budget ?? ""),
    landingPage: c?.landingPage ?? "/",
    owner: c?.owner ?? ws.me.email,
    status: c?.status ?? "planned",
    notes: c?.notes ?? "",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  const save = () =>
    void api("PUT", `/growth/campaigns/${c?.id ?? "new"}`, {
      ...v,
      budget: Number(v.budget) || 0,
    })
      .then(onDone)
      .catch((e: Error) => setError(e.message));
  return (
    <>
      <div className="gw-scrim" onClick={onDone} />
      <aside className="gw-drawer" aria-label="Campaign">
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">{c ? c.name : "New campaign"}</h2>
          <button className="btn ghost" onClick={onDone}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {c && (
          <div className="gw-callout">
            <strong>The campaign's link</strong> (use it everywhere this
            campaign runs)
            <div className="gw-copyrow">
              <input
                readOnly
                value={c.link}
                onFocus={(e) => e.target.select()}
                aria-label="Campaign link"
              />
              <CopyButton text={c.link} />
            </div>
          </div>
        )}
        <div className="gw-form">
          <label className="gw-field">
            <span>Name</span>
            <input value={v.name} onChange={set("name")} />
          </label>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Channel</span>
              <select value={v.channel} onChange={set("channel")}>
                {CHANNELS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>Type</span>
              <select value={v.medium} onChange={set("medium")}>
                {[
                  "paid",
                  "social",
                  "referral",
                  "email",
                  "offline",
                  "other",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>Status</span>
              <select value={v.status} onChange={set("status")}>
                {["planned", "live", "ended"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="gw-field">
            <span>Goal (what success looks like)</span>
            <input
              value={v.goal}
              onChange={set("goal")}
              placeholder="e.g. 50 installs from wedding guests at ₹20 or less each"
            />
          </label>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Start</span>
              <input type="date" value={v.start} onChange={set("start")} />
            </label>
            <label className="gw-field">
              <span>End</span>
              <input type="date" value={v.end} onChange={set("end")} />
            </label>
            <label className="gw-field">
              <span>Budget (₹)</span>
              <input
                type="number"
                min={0}
                value={v.budget}
                onChange={set("budget")}
              />
            </label>
          </div>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Landing page</span>
              <input value={v.landingPage} onChange={set("landingPage")} />
            </label>
            <label className="gw-field">
              <span>Owner</span>
              <select value={v.owner} onChange={set("owner")}>
                <option value="">Unassigned</option>
                {ws.team.map((m) => (
                  <option key={m.email}>{m.email}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="gw-field">
            <span>Notes</span>
            <textarea rows={3} value={v.notes} onChange={set("notes")} />
          </label>
          {c && (
            <p className="small">
              Owner: <Person email={c.owner} /> · code <code>{c.code}</code>
            </p>
          )}
          <div className="btns">
            <button
              className="btn primary"
              disabled={!v.name.trim()}
              onClick={save}
            >
              Save
            </button>
            {c && can(ws, "growth.write") && (
              <button
                className="btn danger"
                onClick={() =>
                  confirm(
                    `Delete the campaign "${c.name}"? Its spend entries stay in the spend log.`,
                  ) &&
                  void api("DELETE", `/growth/campaigns/${c.id}`).then(onDone)
                }
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function SpendForm({
  campaigns,
  campaignId,
  onDone,
}: {
  campaigns: Campaign[];
  campaignId: string;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    category: "ads",
    campaignId,
    note: "",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <>
      <div className="gw-scrim" onClick={onDone} />
      <aside className="gw-drawer" aria-label="Log spend">
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">Log spend</h2>
          <button className="btn ghost" onClick={onDone}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="gw-form">
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Date</span>
              <input type="date" value={v.date} onChange={set("date")} />
            </label>
            <label className="gw-field">
              <span>Amount (₹)</span>
              <input
                type="number"
                min={0}
                value={v.amount}
                onChange={set("amount")}
                autoFocus
              />
            </label>
          </div>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Category</span>
              <select value={v.category} onChange={set("category")}>
                {CATEGORIES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>Campaign</span>
              <select value={v.campaignId} onChange={set("campaignId")}>
                <option value="">None (general)</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="gw-field">
            <span>Note</span>
            <input
              value={v.note}
              onChange={set("note")}
              placeholder="e.g. 200 QR cards printed"
            />
          </label>
          <div className="btns">
            <button
              className="btn primary"
              disabled={!Number(v.amount)}
              onClick={() =>
                void api("PUT", "/growth/spend/new", {
                  ...v,
                  amount: Number(v.amount),
                })
                  .then(onDone)
                  .catch((e: Error) => setError(e.message))
              }
            >
              Save
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
