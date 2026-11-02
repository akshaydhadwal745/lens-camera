// Content studio (docs/growth/content-engine.md): the board of content packages, the package editor
// (format, slides or script, one version per platform), the calendar and the brand kit. The agent drafts
// packages from social tasks; a person edits, a manager approves; nothing is published unapproved.
import { useState } from "react";

import { api, get } from "../../api";
import { Card, Loaded, useLoad } from "../../ui";
import {
  can,
  Chip,
  CopyButton,
  openTask,
  shortDate,
  type Post,
  type PostVariant,
  type Workspace,
} from "./shared";

type Limit = {
  caption: number;
  title?: number;
  hashtags: number;
  formats: string[];
  direct: boolean;
};
export type Brand = {
  colors: Record<
    "background" | "surface" | "primary" | "accent" | "text" | "muted",
    string
  >;
  font: string;
  voice: string;
  dos: string[];
  donts: string[];
  ctas: string[];
  hashtags: string[];
  pillars: string[];
  cadencePerWeek: number;
  languages: string[];
  publishing: Record<string, boolean>;
};
type BrandPage = {
  brand: Brand;
  limits: Record<string, Limit>;
  platforms: string[];
};

const FORMATS: [string, string][] = [
  ["post", "Single image"],
  ["carousel", "Carousel"],
  ["story", "Story"],
  ["reel", "Reel / Short"],
  ["pin", "Pin"],
  ["thread", "Thread"],
  ["article", "Article"],
];
const COLUMNS: { label: string; statuses: string[] }[] = [
  { label: "Ideas & drafts", statuses: ["idea", "drafted"] },
  { label: "In review", statuses: ["in_review"] },
  { label: "Approved", statuses: ["approved", "scheduled"] },
  { label: "Published", statuses: ["published"] },
];
const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
  x: "X",
  reddit: "Reddit",
};
const IMAGE_FORMATS = ["post", "carousel", "story", "pin"];
const isVideo = (f: string) => f === "reel" || f === "short";

/** Same text the server exports (growth-content-rules.ts postText): Instagram captions carry no link. */
function postText(v: PostVariant, link: string, platform: string) {
  return [
    v.caption.trim(),
    v.cta.trim(),
    platform === "instagram" ? "" : link,
    v.hashtags.join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- the studio ----------

export function ContentStudio({ ws }: { ws: Workspace }) {
  const [tab, setTab] = useState<"posts" | "calendar">("posts");
  const [edit, setEdit] = useState<Post | "new" | null>(null);
  const [archived, setArchived] = useState(false);
  const kit = useLoad(() => get<BrandPage>("/growth/brand"), []);
  const posts = ws.posts.filter((p) => archived || p.status !== "archived");
  return (
    <Card
      title="Content"
      actions={
        <span className="gw-row">
          <div className="tabs" role="tablist">
            {(
              [
                ["posts", "Posts"],
                ["calendar", "Calendar"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                className={tab === k ? "tab on" : "tab"}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {can(ws, "growth.contribute") && (
            <button className="btn" onClick={() => setEdit("new")}>
              + New post
            </button>
          )}
        </span>
      }
    >
      {tab === "calendar" ? (
        <CalendarGrid ws={ws} onOpen={setEdit} />
      ) : (
        <>
          <div className="gw-board">
            {COLUMNS.map((c) => {
              const col = posts
                .filter((p) => c.statuses.includes(p.status))
                .sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
              return (
                <div key={c.label} className="gw-col">
                  <h3>
                    {c.label}
                    <span>{col.length}</span>
                  </h3>
                  {col.map((p) => (
                    <PostCard key={p.id} p={p} onOpen={() => setEdit(p)} />
                  ))}
                  {!col.length && (
                    <span className="muted small">Nothing here</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small">
            The agent turns social tasks into content packages (one idea, made
            for each platform). You edit, a growth lead approves, and only
            approved posts go out. Each platform gets its own tagged link, so
            visits are counted per post and platform.{" "}
            <button
              className="gw-linkbtn"
              onClick={() => setArchived(!archived)}
            >
              {archived ? "Hide archived" : "Show archived"}
            </button>
          </p>
        </>
      )}
      {edit && (
        <Loaded state={kit}>
          {(k) => (
            <PostEditor
              ws={ws}
              kit={k}
              p={edit === "new" ? undefined : edit}
              onDone={() => setEdit(null)}
            />
          )}
        </Loaded>
      )}
    </Card>
  );
}

/** This week and next, by publish date; ideas without a date below. */
function CalendarGrid({
  ws,
  onOpen,
}: {
  ws: Workspace;
  onOpen: (p: Post) => void;
}) {
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 14 }, (_, i) =>
    new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  );
  const live = ws.posts.filter((p) => p.status !== "archived");
  const undated = live.filter((p) => !p.date);
  return (
    <>
      <div className="gw-cal">
        {days.map((d) => (
          <div
            key={d}
            className={`gw-day ${d === new Date().toISOString().slice(0, 10) ? "today" : ""}`}
          >
            <b>
              {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
              })}
            </b>
            {live
              .filter((p) => p.date === d)
              .map((p) => (
                <button
                  key={p.id}
                  className={`gw-post ${p.channel}`}
                  onClick={() => onOpen(p)}
                >
                  <strong>
                    {Object.keys(p.variants ?? {})
                      .map((k) => PLATFORM_LABEL[k] ?? k)
                      .join(", ") || p.channel}
                  </strong>
                  <span>{p.title || p.hook || p.body.slice(0, 50)}</span>
                  <span className="small">
                    {p.status.replace("_", " ")}
                    {p.visits ? ` · ${p.visits} visits` : ""}
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>
      {undated.length > 0 && (
        <p className="small">
          Ideas without a date:{" "}
          {undated.map((p) => (
            <button
              key={p.id}
              className="gw-linkbtn"
              onClick={() => onOpen(p)}
            >
              {p.title || p.hook || p.channel}
            </button>
          ))}
        </p>
      )}
    </>
  );
}

function PostCard({ p, onOpen }: { p: Post; onOpen: () => void }) {
  const platforms = Object.keys(p.variants ?? {});
  return (
    <button className="gw-card" onClick={onOpen}>
      <span className="gw-row">
        <Chip tone="acc">
          {FORMATS.find(([k]) => k === p.format)?.[1] ?? p.channel}
        </Chip>
        <span className="muted small">
          {p.date ? shortDate(p.date) : "no date"}
        </span>
      </span>
      <span className="gw-task-title">{p.title || p.hook || "Untitled"}</span>
      <span className="muted small">
        {platforms.length
          ? platforms.map((k) => PLATFORM_LABEL[k] ?? k).join(" · ")
          : p.channel}
        {p.visits ? ` · ${p.visits} visits` : ""}
      </span>
      {(p.problems?.length ?? 0) > 0 && (
        <Chip tone="warn">
          {p.problems!.length} to fix before approval
        </Chip>
      )}
      {p.createdBy === "agent" && p.status === "in_review" && (
        <span className="muted small">Drafted by the agent</span>
      )}
    </button>
  );
}

// ---------- the package editor ----------

type Draft = {
  title: string;
  format: string;
  pillar: string;
  date: string;
  page: string;
  hook: string;
  body: string;
  status: string;
  slides: { headline: string; body: string; visual: string }[];
  script: { seconds: number; onScreen: string; visual: string }[];
  variants: Record<string, PostVariant>;
};

const emptyVariant = (): PostVariant => ({
  caption: "",
  hashtags: [],
  cta: "",
  title: "",
  altText: "",
});

function PostEditor({
  ws,
  kit,
  p,
  onDone,
}: {
  ws: Workspace;
  kit: BrandPage;
  p?: Post;
  onDone: () => void;
}) {
  const [v, setV] = useState<Draft>({
    title: p?.title ?? "",
    format: p?.format ?? "carousel",
    pillar: p?.pillar ?? "",
    date: p?.date ?? "",
    page: p?.page ?? "/",
    hook: p?.hook ?? "",
    body: p?.body ?? "",
    status: p?.status ?? "idea",
    slides: p?.slides ?? [],
    script: p?.script ?? [],
    variants: p?.variants ?? {},
  });
  const [post, setPost] = useState<Post | undefined>(p);
  const [platform, setPlatform] = useState(
    Object.keys(p?.variants ?? {})[0] ?? "",
  );
  const [pubUrls, setPubUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const manager = can(ws, "growth.write");
  const editable = can(ws, "growth.contribute");
  const approved = post?.status === "approved" || post?.status === "scheduled";
  const fits = (k: string) => kit.limits[k]?.formats.includes(v.format);
  const set = <K extends keyof Draft>(k: K, val: Draft[K]) =>
    setV((d) => ({ ...d, [k]: val }));

  const call = async (fn: () => Promise<{ post: Post }>, close = false) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      setPost(r.post);
      dispatchEvent(new Event("growth-reload"));
      if (close) onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = (extra: Record<string, unknown> = {}) =>
    call(() =>
      api("PUT", `/growth/posts/${post?.id ?? "new"}`, { ...v, ...extra }),
    );
  const togglePlatform = (k: string) => {
    const next = { ...v.variants };
    if (next[k]) delete next[k];
    else next[k] = emptyVariant();
    set("variants", next);
    if (!next[platform]) setPlatform(Object.keys(next)[0] ?? "");
    if (next[k]) setPlatform(k);
  };
  const setVariant = (k: string, patch: Partial<PostVariant>) =>
    set("variants", { ...v.variants, [k]: { ...v.variants[k], ...patch } });
  const remove = async () => {
    if (!post || !confirm("Delete this post? Its links stop being counted."))
      return;
    try {
      await api("DELETE", `/growth/posts/${post.id}`);
      dispatchEvent(new Event("growth-reload"));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const seconds = v.script.reduce((a, s) => a + (Number(s.seconds) || 0), 0);
  const cur = platform && v.variants[platform];
  const limit = platform ? kit.limits[platform] : undefined;
  const link =
    (platform && post?.links?.[platform]) ||
    "https://lens.instagrowapp.com/… (link appears after saving)";
  const length = cur ? [...postText(cur, link, platform)].length : 0;

  return (
    <>
      <div className="gw-scrim" onClick={onDone} />
      <aside className="gw-drawer wide" aria-label="Content package">
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">
            {post ? post.title || "Post" : "New post"}
          </h2>
          <button className="btn ghost" onClick={onDone}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {post && (
          <div className="gw-row">
            <Chip
              tone={
                approved
                  ? "good"
                  : post.status === "in_review"
                    ? "warn"
                    : "plain"
              }
            >
              {post.status.replace("_", " ")}
            </Chip>
            {approved && post.approvedBy && (
              <span className="muted small">
                Approved by {post.approvedBy.split("@")[0]}. Any change to the
                content takes the approval back.
              </span>
            )}
            {post.taskId && (
              <button
                className="gw-linkbtn small"
                onClick={() => openTask(post.taskId)}
              >
                Task {post.taskId}
              </button>
            )}
          </div>
        )}
        {(post?.problems?.length ?? 0) > 0 && (
          <div className="notice warn">
            <strong>Fix before approving</strong>
            <ul>
              {post!.problems!.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {post?.body && post.createdBy === "agent" && (
          <div className="gw-callout">
            <strong>Why the agent suggests this</strong>
            <p className="small" style={{ margin: 0 }}>
              {post.body}
            </p>
          </div>
        )}

        <fieldset className="gw-form" disabled={!editable || busy}>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Name (for the calendar)</span>
              <input
                value={v.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </label>
            <label className="gw-field">
              <span>Format</span>
              <select
                value={v.format}
                onChange={(e) => set("format", e.target.value)}
              >
                {FORMATS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Pillar</span>
              <select
                value={v.pillar}
                onChange={(e) => set("pillar", e.target.value)}
              >
                <option value="">None</option>
                {kit.brand.pillars.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>Publish on</span>
              <input
                type="date"
                value={v.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </label>
            <label className="gw-field">
              <span>Website page it points to</span>
              <input
                value={v.page}
                onChange={(e) => set("page", e.target.value)}
              />
            </label>
          </div>
          <label className="gw-field">
            <span>Hook (first line, first slide or first 2 seconds)</span>
            <input
              value={v.hook}
              onChange={(e) => set("hook", e.target.value)}
              placeholder="Phone full again?"
            />
          </label>

          {isVideo(v.format) ? (
            <ListEditor
              title={`Script · ${seconds} seconds`}
              hint="Each scene: how long, the words on screen (≤ 8), and what to show (an app screen, a screen recording, an illustration)."
              rows={v.script}
              onChange={(rows) => set("script", rows)}
              blank={{ seconds: 3, onScreen: "", visual: "" }}
              fields={[
                ["seconds", "Seconds", "number"],
                ["onScreen", "On-screen text", "text"],
                ["visual", "What to show", "text"],
              ]}
            />
          ) : IMAGE_FORMATS.includes(v.format) ? (
            <ListEditor
              title={v.format === "carousel" ? "Slides (2–10)" : "Image"}
              hint="Lens makes the visuals from these notes: on-brand templates, illustrations, real app screens. Never stock photos of people."
              rows={v.slides}
              onChange={(rows) => set("slides", rows)}
              blank={{ headline: "", body: "", visual: "" }}
              max={v.format === "carousel" ? 10 : 1}
              fields={[
                ["headline", "Headline", "text"],
                ["body", "Text", "text"],
                ["visual", "What to show", "text"],
              ]}
            />
          ) : null}

          <div className="gw-field">
            <span>Platforms</span>
            <div className="chips">
              {kit.platforms.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={v.variants[k] ? "chip on" : "chip"}
                  disabled={!fits(k) && !v.variants[k]}
                  title={
                    fits(k) ? "" : `${PLATFORM_LABEL[k]} doesn't take this format`
                  }
                  onClick={() => togglePlatform(k)}
                >
                  {PLATFORM_LABEL[k] ?? k}
                </button>
              ))}
            </div>
          </div>

          {Object.keys(v.variants).length > 0 && (
            <div className="tabs" role="tablist">
              {Object.keys(v.variants).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={platform === k}
                  className={platform === k ? "tab on" : "tab"}
                  onClick={() => setPlatform(k)}
                >
                  {PLATFORM_LABEL[k] ?? k}
                </button>
              ))}
            </div>
          )}
          {cur && limit && (
            <div className="gw-variant">
              {limit.title !== undefined && (
                <label className="gw-field">
                  <span>
                    Title · {[...cur.title].length}/{limit.title}
                  </span>
                  <input
                    value={cur.title}
                    onChange={(e) =>
                      setVariant(platform, { title: e.target.value })
                    }
                  />
                </label>
              )}
              <label className="gw-field">
                <span>
                  Caption · {length}/{limit.caption} with call to action,
                  {platform === "instagram" ? "" : " link"} and hashtags
                </span>
                <textarea
                  rows={7}
                  value={cur.caption}
                  onChange={(e) =>
                    setVariant(platform, { caption: e.target.value })
                  }
                />
              </label>
              <div className="gw-form-row">
                <label className="gw-field">
                  <span>Call to action</span>
                  <input
                    list="gw-ctas"
                    value={cur.cta}
                    onChange={(e) =>
                      setVariant(platform, { cta: e.target.value })
                    }
                  />
                  <datalist id="gw-ctas">
                    {kit.brand.ctas.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </label>
                <label className="gw-field">
                  <span>
                    Hashtags · {cur.hashtags.length}/{limit.hashtags}
                  </span>
                  <input
                    value={cur.hashtags.join(" ")}
                    disabled={limit.hashtags === 0}
                    placeholder={limit.hashtags ? kit.brand.hashtags.slice(0, 3).join(" ") : "Not used here"}
                    onChange={(e) =>
                      setVariant(platform, {
                        hashtags: e.target.value
                          .split(/[\s,]+/)
                          .filter(Boolean)
                          .map((t) => `#${t.replace(/^#+/, "")}`),
                      })
                    }
                  />
                </label>
              </div>
              {IMAGE_FORMATS.includes(v.format) && (
                <label className="gw-field">
                  <span>Alt text (describes the image)</span>
                  <input
                    value={cur.altText}
                    onChange={(e) =>
                      setVariant(platform, { altText: e.target.value })
                    }
                  />
                </label>
              )}
              {post && (
                <div className="gw-callout">
                  <strong>
                    Ready to paste for {PLATFORM_LABEL[platform]}
                  </strong>
                  <pre className="gw-pre">
                    {postText(cur, link, platform)}
                  </pre>
                  <div className="gw-row">
                    <CopyButton text={postText(cur, link, platform)} />
                    {platform === "instagram" && post.links?.instagram && (
                      <span className="muted small">
                        Link for the bio: {post.links.instagram}{" "}
                        <CopyButton text={post.links.instagram} />
                      </span>
                    )}
                  </div>
                  {!approved && post.status !== "published" && (
                    <span className="muted small">
                      Post it only after it’s approved.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <label className="gw-field">
            <span>Notes</span>
            <textarea
              rows={3}
              value={v.body}
              onChange={(e) => set("body", e.target.value)}
            />
          </label>
        </fieldset>

        {approved && editable && (
          <div className="gw-callout">
            <strong>Posted it by hand? Paste the links</strong>
            {Object.keys(post!.variants ?? {}).map((k) => (
              <label key={k} className="gw-field">
                <span>{PLATFORM_LABEL[k]} post URL</span>
                <input
                  value={pubUrls[k] ?? ""}
                  placeholder="https://"
                  onChange={(e) =>
                    setPubUrls({ ...pubUrls, [k]: e.target.value })
                  }
                />
              </label>
            ))}
            <div className="btns">
              <button
                className="btn"
                disabled={busy || !Object.values(pubUrls).some((x) => x.trim())}
                onClick={() =>
                  void call(() =>
                    api("PUT", `/growth/posts/${post!.id}`, {
                      published: pubUrls,
                    }),
                  )
                }
              >
                Mark published
              </button>
            </div>
          </div>
        )}
        {post?.published && Object.keys(post.published).length > 0 && (
          <p className="small">
            Published:{" "}
            {Object.entries(post.published).map(([k, x]) => (
              <a key={k} href={x.url} target="_blank" rel="noreferrer">
                {PLATFORM_LABEL[k] ?? k}{" "}
              </a>
            ))}
          </p>
        )}

        <div className="btns">
          {editable && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {post ? "Save" : "Create"}
            </button>
          )}
          {post && manager && !approved && post.status !== "published" && (
            <button
              className="btn"
              disabled={busy || (post.problems?.length ?? 0) > 0}
              title={
                post.problems?.length
                  ? "Fix the problems listed above first"
                  : "Approve exactly this version for publishing"
              }
              onClick={() =>
                void call(() => api("POST", `/growth/posts/${post.id}/approve`))
              }
            >
              Approve
            </button>
          )}
          {post && manager && approved && (
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void call(() =>
                  api("DELETE", `/growth/posts/${post.id}/approve`),
                )
              }
            >
              Take approval back
            </button>
          )}
          {post && editable && post.status !== "archived" && (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() =>
                void call(
                  () =>
                    api("PUT", `/growth/posts/${post.id}`, {
                      status: "archived",
                    }),
                  true,
                )
              }
            >
              Archive
            </button>
          )}
          {post && manager && (
            <button className="btn danger" onClick={() => void remove()}>
              Delete
            </button>
          )}
        </div>
        {post && (
          <p className="muted small">
            Saving checks every platform’s limits and our product facts.
            Approving needs a growth lead and a package with nothing to fix.
          </p>
        )}
      </aside>
    </>
  );
}

function ListEditor<T extends Record<string, string | number>>({
  title,
  hint,
  rows,
  onChange,
  blank,
  fields,
  max = 12,
}: {
  title: string;
  hint: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: T;
  fields: [keyof T & string, string, "text" | "number"][];
  max?: number;
}) {
  const update = (i: number, k: keyof T, val: string) =>
    onChange(
      rows.map((r, j) =>
        j === i ? { ...r, [k]: typeof blank[k] === "number" ? Number(val) : val } : r,
      ),
    );
  const move = (i: number, d: number) => {
    const next = [...rows];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div className="gw-field">
      <span>{title}</span>
      <span className="muted small">{hint}</span>
      {rows.map((r, i) => (
        <div key={i} className="gw-listrow">
          <b className="muted small">{i + 1}</b>
          {fields.map(([k, label, type]) => (
            <input
              key={k}
              type={type}
              aria-label={`${label} ${i + 1}`}
              placeholder={label}
              value={String(r[k] ?? "")}
              className={type === "number" ? "gw-num" : undefined}
              onChange={(e) => update(i, k, e.target.value)}
            />
          ))}
          <span className="gw-row">
            <button
              type="button"
              className="btn ghost small"
              disabled={i === 0}
              aria-label="Move up"
              onClick={() => move(i, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn ghost small"
              aria-label="Remove"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </span>
        </div>
      ))}
      {rows.length < max && (
        <button
          type="button"
          className="btn small"
          onClick={() => onChange([...rows, { ...blank }])}
        >
          + Add
        </button>
      )}
    </div>
  );
}

// ---------- brand kit (Growth settings) ----------

export function BrandKit({ ws }: { ws: Workspace }) {
  const state = useLoad(() => get<BrandPage>("/growth/brand"), []);
  return (
    <Loaded state={state}>
      {(k) => <BrandForm ws={ws} initial={k.brand} />}
    </Loaded>
  );
}

function BrandForm({ ws, initial }: { ws: Workspace; initial: Brand }) {
  const [b, setB] = useState(initial);
  const [msg, setMsg] = useState("");
  const editable = can(ws, "growth.write");
  const lines = (k: "dos" | "donts" | "ctas" | "hashtags" | "pillars") => (
    <label className="gw-field">
      <span>
        {
          {
            dos: "Do (one per line)",
            donts: "Don't (one per line)",
            ctas: "Calls to action (one per line)",
            hashtags: "Hashtags to draw from (one per line)",
            pillars: "Content pillars (one per line)",
          }[k]
        }
      </span>
      <textarea
        rows={4}
        value={b[k].join("\n")}
        onChange={(e) => setB({ ...b, [k]: e.target.value.split("\n") })}
      />
    </label>
  );
  const save = async () => {
    setMsg("");
    try {
      const r = await api<{ brand: Brand }>("PUT", "/growth/brand", {
        ...b,
        dos: b.dos.filter((x) => x.trim()),
        donts: b.donts.filter((x) => x.trim()),
        ctas: b.ctas.filter((x) => x.trim()),
        hashtags: b.hashtags.filter((x) => x.trim()),
        pillars: b.pillars.filter((x) => x.trim()),
      });
      setB(r.brand);
      setMsg("Saved. The agent uses it from its next draft.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Card title="Brand kit and content settings">
      <fieldset className="gw-form" disabled={!editable}>
        <div className="gw-swatches">
          {(Object.keys(b.colors) as (keyof Brand["colors"])[]).map((c) => (
            <label key={c} className="gw-field">
              <span>{c}</span>
              <input
                type="color"
                value={b.colors[c]}
                onChange={(e) =>
                  setB({ ...b, colors: { ...b.colors, [c]: e.target.value } })
                }
              />
            </label>
          ))}
        </div>
        <label className="gw-field">
          <span>Voice</span>
          <textarea
            rows={3}
            value={b.voice}
            onChange={(e) => setB({ ...b, voice: e.target.value })}
          />
        </label>
        <div className="grid2">
          {lines("dos")}
          {lines("donts")}
          {lines("ctas")}
          {lines("hashtags")}
        </div>
        {lines("pillars")}
        <div className="gw-form-row">
          <label className="gw-field">
            <span>Posts the agent plans a week</span>
            <input
              type="number"
              min={0}
              max={14}
              value={b.cadencePerWeek}
              onChange={(e) =>
                setB({ ...b, cadencePerWeek: Number(e.target.value) })
              }
            />
          </label>
          <label className="gw-field">
            <span>Languages</span>
            <select
              value={b.languages.join(",")}
              onChange={(e) => setB({ ...b, languages: e.target.value.split(",") })}
            >
              <option value="en">English</option>
              <option value="en,hi">English + Hindi</option>
            </select>
          </label>
        </div>
        <p className="muted small">
          Direct publishing is off for every platform until the accounts are
          connected. Until then, approved posts are copied and posted by hand.
        </p>
        {editable && (
          <div className="btns">
            <button className="btn primary" type="button" onClick={() => void save()}>
              Save brand kit
            </button>
            {msg && <span className="small">{msg}</span>}
          </div>
        )}
      </fieldset>
    </Card>
  );
}
