// Content studio (docs/growth/content-engine.md): the board of content packages, the package editor
// (format, slides or script, one version per platform), the calendar and the brand kit. The agent drafts
// packages from social tasks; a person edits, a manager approves; nothing is published unapproved.
import { useEffect, useState } from "react";

import { api, get, post } from "../../api";
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
import { elapsed, reelStage, type ReelJob } from "./jobs";

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
  focus: string[];
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

/** Same count as the server (growth-content-rules.ts textLength): X shortens every link to 23 characters. */
function textLength(text: string, platform: string) {
  const t =
    platform === "x" ? text.replace(/https?:\/\/\S+/g, "x".repeat(23)) : text;
  return [...t].length;
}

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
  const [tab, setTab] = useState<"posts" | "calendar" | "moments" | "library">(
    "posts",
  );
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
                ["moments", "Moments"],
                ["library", "Library"],
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
      {tab === "library" ? (
        <Library ws={ws} />
      ) : tab === "moments" ? (
        <Moments ws={ws} />
      ) : tab === "calendar" ? (
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
            <button key={p.id} className="gw-linkbtn" onClick={() => onOpen(p)}>
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
      {p.make &&
        (p.make.images === "todo" ||
          p.make.images === "running" ||
          p.make.reel === "todo" ||
          p.make.reel === "started") && (
          <Chip tone="acc">
            {p.make.images === "todo" || p.make.images === "running"
              ? "Making images…"
              : "Making the reel…"}
          </Chip>
        )}
      <span className="muted small">
        {platforms.length
          ? platforms.map((k) => PLATFORM_LABEL[k] ?? k).join(" · ")
          : p.channel}
        {p.visits ? ` · ${p.visits} visits` : ""}
      </span>
      {(p.problems?.length ?? 0) > 0 && (
        <Chip tone="warn">{p.problems!.length} to fix before approval</Chip>
      )}
      {p.score && (
        <Chip
          tone={
            p.score.total >= 80 ? "good" : p.score.total >= 60 ? "warn" : "bad"
          }
        >
          Score {p.score.total}/100
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
  assets: { id: string; role: string }[];
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
    assets: p?.assets ?? [],
  });
  const library = useAssets();
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
  const length = cur ? textLength(postText(cur, link, platform), platform) : 0;

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

          <Loaded state={library}>
            {({ assets }) => (
              <MediaPicker
                assets={assets}
                value={v.assets}
                onChange={(x) => set("assets", x)}
              />
            )}
          </Loaded>

          {post?.id && isVideo(post.format ?? "") && (
            <Reel ws={ws} post={post} />
          )}
          {post?.id && <Images ws={ws} post={post} />}

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
                    fits(k)
                      ? ""
                      : `${PLATFORM_LABEL[k]} doesn't take this format`
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
                    placeholder={
                      limit.hashtags
                        ? kit.brand.hashtags.slice(0, 3).join(" ")
                        : "Not used here"
                    }
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
                  <strong>Ready to paste for {PLATFORM_LABEL[platform]}</strong>
                  <pre className="gw-pre">{postText(cur, link, platform)}</pre>
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

function MediaPicker({
  assets,
  value,
  onChange,
}: {
  assets: Asset[];
  value: { id: string; role: string }[];
  onChange: (v: { id: string; role: string }[]) => void;
}) {
  const ready = assets.filter(
    (a) => a.status === "ready" && !value.some((x) => x.id === a.id),
  );
  return (
    <div className="gw-field">
      <span>Media from the library</span>
      <span className="muted small">
        Main visuals are our own photos, recordings and designs; licensed stock
        only as a background or reference. Anything not cleared blocks approval.
      </span>
      {value.map((r) => {
        const a = assets.find((x) => x.id === r.id);
        return (
          <div key={r.id} className="gw-media">
            {a ? (
              <Thumb a={a} />
            ) : (
              <div className="gw-thumb empty">Deleted</div>
            )}
            <span>
              {a?.name ?? "Deleted file"}
              {a && (
                <>
                  <br />
                  <Chip tone={RIGHTS_TONE[a.rightsStatus]}>
                    {RIGHTS_LABEL[a.rightsStatus]}
                  </Chip>
                </>
              )}
            </span>
            <select
              aria-label="Role"
              value={r.role}
              onChange={(e) =>
                onChange(
                  value.map((x) =>
                    x.id === r.id ? { ...x, role: e.target.value } : x,
                  ),
                )
              }
            >
              <option value="media">Main visual</option>
              <option value="background">Background</option>
              <option value="reference">Reference only</option>
            </select>
            <button
              type="button"
              className="btn ghost small"
              aria-label="Remove"
              onClick={() => onChange(value.filter((x) => x.id !== r.id))}
            >
              ✕
            </button>
          </div>
        );
      })}
      {ready.length > 0 ? (
        <select
          aria-label="Add from the library"
          value=""
          onChange={(e) => {
            const a = assets.find((x) => x.id === e.target.value);
            if (a)
              onChange([
                ...value,
                {
                  id: a.id,
                  role: a.rights.license === "own" ? "media" : "background",
                },
              ]);
          }}
        >
          <option value="">+ Add from the library…</option>
          {ready.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({RIGHTS_LABEL[a.rightsStatus].toLowerCase()})
            </option>
          ))}
        </select>
      ) : (
        !value.length && (
          <span className="muted small">
            The library is empty: upload in the Library tab.
          </span>
        )
      )}
    </div>
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
        j === i
          ? { ...r, [k]: typeof blank[k] === "number" ? Number(val) : val }
          : r,
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

// ---------- library (phase 2): files with their rights ----------

export type Asset = {
  id: string;
  name: string;
  kind: string;
  postId?: string; // renders: the post they were drawn for
  designedBy?: "ai" | "template"; // renders: who designed it
  score?: number; // renders: what the AI creative director gave it, 0–100
  scoreWhy?: string;
  idea?: string;
  problems?: string[];
  label?: string;
  w?: number;
  h?: number;
  origin: string;
  mime: string;
  bytes: number;
  lensPhoto: boolean;
  status: "uploading" | "ready";
  rightsStatus: "cleared" | "review" | "blocked";
  credit: string;
  url: string;
  usedIn: { id: string; title: string }[];
  createdAt: number;
  createdBy: string;
  rights: {
    license: string;
    licenseUrl: string;
    source: string;
    author: string;
    reason: string;
    peopleOrBrands: boolean;
    decision?: { status: string; note: string; by: string; at: number };
  };
};
const RIGHTS_TONE = {
  cleared: "good",
  review: "warn",
  blocked: "bad",
} as const;
const RIGHTS_LABEL = {
  cleared: "Cleared",
  review: "Needs a rights decision",
  blocked: "Can't be used",
};

export const useAssets = () =>
  useLoad(() => get<{ assets: Asset[] }>("/growth/assets"), []);

function Thumb({ a }: { a: Asset }) {
  if (!a.url) return <div className="gw-thumb empty">Uploading…</div>;
  if (a.mime.startsWith("audio/"))
    return <div className="gw-thumb empty">♪ Music</div>;
  return a.mime.startsWith("video/") ? (
    <video className="gw-thumb" src={a.url} muted preload="metadata" />
  ) : (
    <img className="gw-thumb" src={a.url} alt={a.name} loading="lazy" />
  );
}

function Library({ ws }: { ws: Workspace }) {
  const [n, setN] = useState(0);
  const state = useLoad(() => get<{ assets: Asset[] }>("/growth/assets"), [n]);
  const [filter, setFilter] = useState<
    "all" | "review" | "cleared" | "blocked"
  >("all");
  const [open, setOpen] = useState<Asset | null>(null);
  const [adding, setAdding] = useState(false);
  const reload = () => setN((x) => x + 1);
  return (
    <Loaded state={state}>
      {({ assets }) => {
        const shown = assets.filter(
          (a) => filter === "all" || a.rightsStatus === filter,
        );
        return (
          <div className="gw-stack">
            <div className="gw-row">
              <div className="chips">
                {(["all", "review", "cleared", "blocked"] as const).map((f) => (
                  <button
                    key={f}
                    className={filter === f ? "chip on" : "chip"}
                    onClick={() => setFilter(f)}
                  >
                    {f === "all" ? "All" : RIGHTS_LABEL[f]} (
                    {f === "all"
                      ? assets.length
                      : assets.filter((a) => a.rightsStatus === f).length}
                    )
                  </button>
                ))}
              </div>
              {can(ws, "growth.contribute") && (
                <button className="btn" onClick={() => setAdding(true)}>
                  + Upload
                </button>
              )}
            </div>
            {shown.length ? (
              <div className="gw-assets">
                {shown.map((a) => (
                  <button
                    key={a.id}
                    className="gw-card"
                    onClick={() => setOpen(a)}
                  >
                    <Thumb a={a} />
                    <span className="gw-task-title">{a.name}</span>
                    <span className="gw-row">
                      <Chip tone={RIGHTS_TONE[a.rightsStatus]}>
                        {RIGHTS_LABEL[a.rightsStatus]}
                      </Chip>
                      <span className="muted small">
                        {a.lensPhoto ? "Lens photo · " : ""}
                        {a.usedIn.length
                          ? `in ${a.usedIn.length} post${a.usedIn.length > 1 ? "s" : ""}`
                          : "unused"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">
                Nothing here yet. Upload photos taken with Lens, screen
                recordings of the app and designs. Licensed images from other
                sites can be backgrounds or references only.
              </p>
            )}
            {adding && (
              <UploadForm
                onDone={(ok) => {
                  setAdding(false);
                  if (ok) reload();
                }}
              />
            )}
            {open && (
              <AssetPanel
                ws={ws}
                a={open}
                onDone={(changed) => {
                  setOpen(null);
                  if (changed) reload();
                }}
              />
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

function UploadForm({ onDone }: { onDone: (ok: boolean) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [v, setV] = useState({
    name: "",
    kind: "photo",
    madeBy: "us" as "us" | "other",
    checkedPersonal: false,
    lensPhoto: false,
    peopleOrBrands: false,
    source: "",
    license: "",
    author: "",
    licenseUrl: "",
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const upload = async () => {
    if (!file) return;
    setError("");
    try {
      setBusy("Checking…");
      const r = await api<{
        asset: { id: string };
        url: string;
        headers: Record<string, string>;
      }>("POST", "/growth/assets/upload", {
        ...v,
        name: v.name || file.name.replace(/\.[^.]+$/, ""),
        contentType: file.type,
        bytes: file.size,
      });
      setBusy("Uploading…");
      const put = await fetch(r.url, {
        method: "PUT",
        headers: r.headers,
        body: file,
      });
      if (!put.ok) throw new Error("The upload failed. Try again.");
      setBusy("Finishing…");
      await api("POST", `/growth/assets/${r.asset.id}/done`);
      onDone(true);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  };
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) =>
    setV({ ...v, [k]: val });
  return (
    <>
      <div className="gw-scrim" onClick={() => onDone(false)} />
      <aside className="gw-drawer" aria-label="Upload">
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">Upload to the library</h2>
          <button className="btn ghost" onClick={() => onDone(false)}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        <fieldset className="gw-form" disabled={!!busy}>
          <label className="gw-field">
            <span>
              File (JPEG, PNG, WebP up to 30 MB; MP4 or MOV up to 200 MB)
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Name</span>
              <input
                value={v.name}
                placeholder={file?.name ?? ""}
                onChange={(e) => set("name", e.target.value)}
              />
            </label>
            <label className="gw-field">
              <span>What is it</span>
              <select
                value={v.kind}
                onChange={(e) =>
                  setV({
                    ...v,
                    kind: e.target.value,
                    lensPhoto: e.target.value === "photo" && v.lensPhoto,
                  })
                }
              >
                <option value="photo">Photo</option>
                <option value="screen-recording">Screen recording</option>
                <option value="video">Video</option>
                <option value="image">Design or image</option>
                <option value="illustration">Illustration</option>
              </select>
            </label>
          </div>
          <div className="gw-field">
            <span>Who made it?</span>
            <div className="chips">
              <button
                type="button"
                className={v.madeBy === "us" ? "chip on" : "chip"}
                onClick={() => set("madeBy", "us")}
              >
                Our team
              </button>
              <button
                type="button"
                className={v.madeBy === "other" ? "chip on" : "chip"}
                onClick={() => set("madeBy", "other")}
              >
                Someone else (licensed)
              </button>
            </div>
          </div>
          {v.madeBy === "us" ? (
            <>
              <label className="gw-check">
                <input
                  type="checkbox"
                  checked={v.checkedPersonal}
                  onChange={(e) => set("checkedPersonal", e.target.checked)}
                />
                I checked every frame: no personal photos, faces, names,
                messages or notifications.
              </label>
              {file?.type.startsWith("image/") && v.kind === "photo" && (
                <label className="gw-check">
                  <input
                    type="checkbox"
                    checked={v.lensPhoto}
                    onChange={(e) => set("lensPhoto", e.target.checked)}
                  />
                  This photo was taken with the Lens camera (lets posts say
                  &ldquo;shot on Lens&rdquo;).
                </label>
              )}
            </>
          ) : (
            <>
              <p className="muted small">
                Licensed images and videos can be backgrounds or references
                only, never the main visual. Copy the details from the page you
                got it from.
              </p>
              <label className="gw-field">
                <span>Page you got it from</span>
                <input
                  value={v.source}
                  placeholder="https://"
                  onChange={(e) => set("source", e.target.value)}
                />
              </label>
              <div className="gw-form-row">
                <label className="gw-field">
                  <span>Licence (as shown on that page)</span>
                  <input
                    value={v.license}
                    placeholder="CC BY 4.0, Unsplash License, CC0…"
                    onChange={(e) => set("license", e.target.value)}
                  />
                </label>
                <label className="gw-field">
                  <span>Author</span>
                  <input
                    value={v.author}
                    onChange={(e) => set("author", e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
          <label className="gw-check">
            <input
              type="checkbox"
              checked={v.peopleOrBrands}
              onChange={(e) => set("peopleOrBrands", e.target.checked)}
            />
            Recognisable people, logos or brands are visible.
          </label>
          <div className="btns">
            <button
              className="btn primary"
              type="button"
              disabled={
                !file ||
                (v.madeBy === "us" && !v.checkedPersonal) ||
                (v.madeBy === "other" && (!v.source || !v.license))
              }
              onClick={() => void upload()}
            >
              {busy || "Upload"}
            </button>
          </div>
        </fieldset>
      </aside>
    </>
  );
}

function AssetPanel({
  ws,
  a,
  onDone,
}: {
  ws: Workspace;
  a: Asset;
  onDone: (changed: boolean) => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const manager = can(ws, "growth.write");
  const decide = async (status: "cleared" | "review" | "blocked") => {
    setError("");
    try {
      await api("PUT", `/growth/assets/${a.id}/rights`, { status, note });
      onDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete "${a.name}" from the library?`)) return;
    try {
      await api("DELETE", `/growth/assets/${a.id}`);
      onDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const r = a.rights;
  return (
    <>
      <div className="gw-scrim" onClick={() => onDone(false)} />
      <aside className="gw-drawer" aria-label={a.name}>
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">{a.name}</h2>
          <button className="btn ghost" onClick={() => onDone(false)}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {a.url &&
          (a.mime.startsWith("audio/") ? (
            <audio
              src={a.url}
              controls
              preload="metadata"
              style={{ width: "100%" }}
            />
          ) : a.mime.startsWith("video/") ? (
            <video className="gw-preview" src={a.url} controls muted />
          ) : (
            <img className="gw-preview" src={a.url} alt={a.name} />
          ))}
        <div className="gw-row">
          <Chip tone={RIGHTS_TONE[a.rightsStatus]}>
            {RIGHTS_LABEL[a.rightsStatus]}
          </Chip>
          <span className="muted small">
            {a.kind} · {(a.bytes / 1024 / 1024).toFixed(1)} MB · added by{" "}
            {a.createdBy.split("@")[0]}
          </span>
        </div>
        <dl className="gw-kv">
          <dt>Licence</dt>
          <dd>{r.license === "own" ? "Made by our team" : r.license}</dd>
          {r.source && (
            <>
              <dt>Source</dt>
              <dd>
                <a href={r.source} target="_blank" rel="noreferrer">
                  {r.source}
                </a>
              </dd>
            </>
          )}
          {r.author && (
            <>
              <dt>Author</dt>
              <dd>{r.author}</dd>
            </>
          )}
          {a.credit && (
            <>
              <dt>Credit</dt>
              <dd>
                {a.credit} <CopyButton text={a.credit} />
              </dd>
            </>
          )}
          {r.reason !== "Made by our team" && (
            <>
              <dt>Why</dt>
              <dd>{r.reason}</dd>
            </>
          )}
          <dt>People or brands</dt>
          <dd>{r.peopleOrBrands ? "Visible" : "None"}</dd>
          {r.decision && (
            <>
              <dt>Decision</dt>
              <dd>
                {r.decision.status} by {r.decision.by.split("@")[0]}:{" "}
                {r.decision.note}
              </dd>
            </>
          )}
          <dt>Used in</dt>
          <dd>
            {a.usedIn.length
              ? a.usedIn.map((p) => p.title || p.id).join(", ")
              : "No posts"}
          </dd>
        </dl>
        {manager && (
          <div className="gw-callout">
            <strong>Rights decision</strong>
            <label className="gw-field">
              <span>Note (why it is or isn&apos;t fine to use)</span>
              <input
                value={note}
                placeholder="Model release on file / licence page changed…"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="btns">
              {a.rightsStatus !== "cleared" && (
                <button className="btn" onClick={() => void decide("cleared")}>
                  Clear for use
                </button>
              )}
              <button className="btn" onClick={() => void decide("blocked")}>
                Block
              </button>
              {r.decision && (
                <button
                  className="btn ghost"
                  onClick={() => void decide("review")}
                >
                  Back to review
                </button>
              )}
            </div>
          </div>
        )}
        {manager && (
          <div className="btns">
            <button className="btn danger" onClick={() => void remove()}>
              Delete
            </button>
          </div>
        )}
      </aside>
    </>
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
              onChange={(e) =>
                setB({ ...b, languages: e.target.value.split(",") })
              }
            >
              <option value="en">English</option>
              <option value="en,hi">English + Hindi</option>
            </select>
          </label>
        </div>
        <div className="gw-field">
          <span>Focus platforms</span>
          <span className="muted small">
            The agent makes posts only for these (and images in their sizes).
            Start where traction comes fastest; add more later.
          </span>
          <div className="gw-row" style={{ flexWrap: "wrap", gap: 12 }}>
            {Object.keys(PLATFORM_LABEL).map((k) => (
              <label key={k} className="gw-row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={(b.focus ?? []).includes(k)}
                  disabled={!editable}
                  onChange={(e) =>
                    setB({
                      ...b,
                      focus: e.target.checked
                        ? [...(b.focus ?? []), k]
                        : (b.focus ?? []).filter((x) => x !== k),
                    })
                  }
                />
                {PLATFORM_LABEL[k]}
              </label>
            ))}
          </div>
        </div>
        <p className="muted small">
          Direct publishing is off for every platform until the accounts are
          connected. Until then, approved posts are copied and posted by hand.
        </p>
        {editable && (
          <div className="btns">
            <button
              className="btn primary"
              type="button"
              onClick={() => void save()}
            >
              Save brand kit
            </button>
            {msg && <span className="small">{msg}</span>}
          </div>
        )}
      </fieldset>
    </Card>
  );
}

// ---------- moments (the next 30 days of events worth a timely post) ----------

type Moment = {
  id: string;
  title: string;
  kind: "festival" | "holiday" | "season" | "match" | "concert" | "trend";
  day: string;
  ends?: string;
  time?: string;
  countries: string[];
  source: string;
  url: string;
  score: number;
  angle: string;
  formats: string[];
  hashtags: string[];
  taskId?: string;
};
const KIND_LABEL: Record<Moment["kind"], string> = {
  festival: "Festival",
  holiday: "Holiday",
  season: "Season",
  match: "Match",
  concert: "Concert",
  trend: "Trending",
};
/** Keyed sources: what to add to SSM /lens/growth/moments (free accounts) to switch them on. */
const SOURCE_SETUP: Record<string, string> = {
  cricket: "cricketKey (cricketdata.org)",
  football: "footballKey (football-data.org)",
  concerts: "ticketmasterKey (developer.ticketmaster.com)",
};
const weekday = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short" });

function Moments({ ws }: { ws: Workspace }) {
  const [n, setN] = useState(0);
  const state = useLoad(
    () =>
      get<{
        moments: Moment[];
        sources: Record<string, string>;
        checkedAt: number | null;
      }>("/growth/moments"),
    [n],
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const make = async (m: Moment) => {
    setBusy(m.id);
    setError("");
    try {
      const r = await post<{ taskId: string }>(
        `/growth/moments/${m.id}/content`,
      );
      setN((x) => x + 1);
      openTask(r.taskId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <Loaded state={state}>
      {({ moments, sources, checkedAt }) => (
        <div className="gw-stack">
          <p className="muted small">
            Festivals, holidays, photo days, seasons, big matches, concerts and
            trending searches in the next 30 days from 16 countries, fetched
            every day, best fit for Lens first on each day. “Make content” makes
            the full set by itself: a reel and a carousel for Instagram and
            Facebook and a post for X, with images, music and sound. It all
            waits In review for approval; nothing is published. Elections,
            disasters and days of mourning are never listed.
          </p>
          {error && <p className="notice error">{error}</p>}
          {moments.length ? (
            <ul className="gw-list">
              {moments.map((m) => (
                <li key={m.id} className="gw-card">
                  <span className="gw-row">
                    <span className="gw-task-title">
                      {weekday(m.day)} {shortDate(m.day)}
                      {m.ends ? ` – ${shortDate(m.ends)}` : ""} · {m.title}
                    </span>
                    <span className="gw-row">
                      <Chip
                        tone={
                          m.score >= 80
                            ? "good"
                            : m.score >= 60
                              ? "acc"
                              : "plain"
                        }
                      >
                        Fit {m.score}
                      </Chip>
                      <Chip>{KIND_LABEL[m.kind]}</Chip>
                      <span className="muted small">
                        {m.countries.includes("WW")
                          ? "Worldwide"
                          : m.countries.join(", ")}
                      </span>
                    </span>
                  </span>
                  <span className="small">{m.angle}</span>
                  <span className="muted small">
                    {m.formats.join(", ")} · {m.hashtags.join(" ")} ·{" "}
                    <a href={m.url} target="_blank" rel="noreferrer">
                      {m.source}
                    </a>
                  </span>
                  <span>
                    {m.taskId ? (
                      <button
                        className="btn ghost small"
                        onClick={() => openTask(m.taskId!)}
                      >
                        Open task {m.taskId}
                      </button>
                    ) : (
                      can(ws, "growth.contribute") && (
                        <button
                          className="btn"
                          disabled={!!busy}
                          onClick={() => make(m)}
                        >
                          {busy === m.id ? "Starting…" : "Make content"}
                        </button>
                      )
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No moments yet: the daily pull fills this list (around 11:30 IST).
            </p>
          )}
          <p className="muted small">
            Sources
            {checkedAt
              ? ` (checked ${new Date(checkedAt).toLocaleString("en-GB")})`
              : ""}
            :{" "}
            {Object.entries(sources)
              .filter(([k]) => k !== "sensitiveSkipped")
              .map(([k, v]) =>
                v === "not connected" && SOURCE_SETUP[k]
                  ? `${k}: not connected (add ${SOURCE_SETUP[k]})`
                  : `${k}: ${v}`,
              )
              .join(" · ") || "not run yet"}
          </p>
        </div>
      )}
    </Loaded>
  );
}

// ---------- images drawn from a post (render engine, growth-media.ts) ----------

const scoreTone = (n: number) => (n >= 80 ? "good" : n >= 60 ? "warn" : "bad");

type ReelJobs = {
  reel: ReelJob | null;
  reelDone: { postId: string; at: number; error: string | null } | null;
};

/** The post's reel: the job runs on the server and keeps going if this page closes. */
function Reel({ ws, post }: { ws: Workspace; post: Post }) {
  const [n, setN] = useState(0);
  const lib = useLoad(() => get<{ assets: Asset[] }>("/growth/assets"), [n]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  // Where the builder is: "Drawing frames 45% · 3:10", and the bar under it.
  const [stage, setStage] = useState<{ label: string; pct: number } | null>(
    null,
  );
  const waitFor = async (began: number) => {
    setRunning(true);
    setStage({ label: "Starting · 0:00", pct: 0 });
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        const j = await get<ReelJobs>("/growth/jobs");
        if (j.reel?.postId === post.id) {
          const s = reelStage(j.reel);
          setStage({
            label: `${s.label} · ${elapsed(Date.now() - j.reel.at)}`,
            pct: s.pct,
          });
        }
        const done = j.reelDone;
        if (!j.reel && done?.postId === post.id && done.at >= began - 1000) {
          if (done.error) setError(done.error);
          break;
        }
        if (Date.now() - began > 55 * 60_000) {
          setError(
            "Still making the reel after 55 minutes. Check again in a while.",
          );
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setRunning(false);
    setStage(null);
    setN((x) => x + 1);
  };
  const start = async () => {
    setError("");
    const began = Date.now();
    setRunning(true);
    try {
      await api("POST", `/growth/posts/${post.id}/reel`, {});
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
      return;
    }
    await waitFor(began);
  };
  useEffect(() => {
    let on = true;
    void get<ReelJobs>("/growth/jobs").then(
      (j) => {
        if (on && j.reel?.postId === post.id) void waitFor(j.reel.at);
      },
      () => undefined,
    );
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);
  return (
    <div className="gw-field">
      <span className="gw-row">
        <span>Reel</span>
        {can(ws, "growth.contribute") && (
          <button className="btn small" disabled={running} onClick={start}>
            {running ? "Making reel…" : "Make reel"}
          </button>
        )}
      </span>
      <span className="muted small">
        A vertical video (1080×1920, MP4) for Instagram, Facebook and X. The AI
        writes it around the pain point of this post, designs and animates every
        scene, scores the result and redesigns weak scenes once. Sound is
        included: a voiceover (Ruth, or Kajal for India moments), effects timed
        to each scene, and free-licence music picked for the reel&apos;s mood (credited in the post&apos;s assets). Takes about 20–40 minutes and keeps going if
        you leave this page. Making it again replaces the old one.
      </span>
      {running && stage && (
        <div role="status" aria-live="polite">
          <span className="small">{stage.label}</span>
          <div
            className="gw-bar"
            role="progressbar"
            aria-label="Reel progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={stage.pct}
          >
            <i className="acc" style={{ width: `${stage.pct}%` }} />
          </div>
        </div>
      )}
      {error && <p className="notice error">{error}</p>}
      <Loaded state={lib}>
        {({ assets }) => {
          const reel = assets.find(
            (a) =>
              a.kind === "render" &&
              a.postId === post.id &&
              a.mime.startsWith("video/"),
          );
          if (!reel?.url)
            return <span className="muted small">No reel yet.</span>;
          return (
            <div className="gw-stack">
              <video
                src={reel.url}
                controls
                playsInline
                preload="metadata"
                style={{ maxHeight: 520, maxWidth: "100%", borderRadius: 12 }}
              />
              <div className="gw-row">
                <a className="btn small" href={reel.url} download>
                  Download reel
                </a>
                {post.reelScore ? (
                  <Chip tone={scoreTone(post.reelScore.total)}>
                    Reel score {post.reelScore.total}/100
                  </Chip>
                ) : (
                  <span className="muted small">
                    Not scored: the AI wasn&apos;t available.
                  </span>
                )}
              </div>
              {post.reelScript && (
                <div className="small">
                  <div>
                    <strong>Angle:</strong> {post.reelScript.angle}
                  </div>
                  <div className="muted">
                    For: {post.reelScript.audience}
                    {post.reelScript.voiceName
                      ? ` · Voice: ${post.reelScript.voiceName}`
                      : ""}
                  </div>
                  <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                    {post.reelScript.scenes.map((x, i) => (
                      <li key={i}>
                        “{x.words}”{" "}
                        <span className="muted">
                          · {x.seconds} s · {x.shows}
                          {x.by === "template" ? " · template" : ""}
                        </span>
                        {x.vo ? (
                          <div className="muted">Voice: “{x.vo}”</div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {post.reelScore?.images.map((x) => (
                <span key={x.label} className="small">
                  <Chip tone={scoreTone(x.score)}>{x.score}</Chip> {x.label}:{" "}
                  <span className="muted">{x.why}</span>
                </span>
              ))}
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}

type RenderJobs = {
  render: { postId: string; startedAt: number } | null;
  renderDone: { postId: string; at: number; error: string | null } | null;
};

function Images({ ws, post }: { ws: Workspace; post: Post }) {
  const [n, setN] = useState(0);
  const lib = useLoad(() => get<{ assets: Asset[] }>("/growth/assets"), [n]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  // Waits for the render job, which runs on the server and survives closing or refreshing this page.
  const waitFor = async (began: number) => {
    setRunning(true);
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, 4000));
        const j = await get<RenderJobs>("/growth/jobs");
        const done = j.renderDone;
        if (!j.render && done?.postId === post.id && done.at >= began - 1000) {
          if (done.error) setError(done.error);
          break;
        }
        if (Date.now() - began > 15 * 60_000) {
          setError("Still drawing after 15 minutes. Check again in a while.");
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setRunning(false);
    setN((x) => x + 1);
  };
  const start = async () => {
    setError("");
    const began = Date.now();
    setRunning(true);
    try {
      await api("POST", `/growth/posts/${post.id}/render`, {});
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
      return;
    }
    await waitFor(began);
  };
  useEffect(() => {
    // Opened (or refreshed) while this post's images are being made: pick the job up again.
    let on = true;
    void get<RenderJobs>("/growth/jobs").then(
      (j) => {
        if (on && j.render?.postId === post.id)
          void waitFor(j.render.startedAt);
      },
      () => undefined,
    );
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);
  const [zipping, setZipping] = useState(false);
  const downloadAll = async () => {
    setError("");
    setZipping(true);
    try {
      const { url } = await get<{ url: string }>(
        `/growth/posts/${post.id}/images`,
      );
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
    }
    setZipping(false);
  };
  return (
    <div className="gw-field">
      <span className="gw-row">
        <span>Images</span>
        {can(ws, "growth.contribute") && (
          <button className="btn small" disabled={running} onClick={start}>
            {running ? "Drawing…" : "Make images"}
          </button>
        )}
      </span>
      <span className="muted small">
        Designed by AI for this post (the real app on a phone, photos found
        online and looked at by AI first, brand colours), checked by code; any
        image that fails the checks uses a template. Takes a few minutes and
        keeps going if you leave this page. Save your edits first; making them
        again replaces the old ones.
      </span>
      {error && <p className="notice error">{error}</p>}
      <Loaded state={lib}>
        {({ assets }) => {
          const mine = assets
            .filter(
              (a) =>
                a.kind === "render" &&
                a.postId === post.id &&
                !a.mime.startsWith("video/"),
            )
            .sort((a, b) =>
              (a.label ?? "").localeCompare(b.label ?? "", undefined, {
                numeric: true,
              }),
            );
          return mine.length ? (
            <>
              <div className="gw-row">
                <button
                  className="btn small"
                  disabled={zipping || running}
                  onClick={downloadAll}
                >
                  {zipping ? "Getting zip…" : `Download all (${mine.length})`}
                </button>
                <span className="muted small">
                  One zip with every image and a note saying which goes where.
                </span>
              </div>
              {post.score ? (
                <p className="small">
                  <Chip tone={scoreTone(post.score.total)}>
                    Post score {post.score.total}/100
                  </Chip>{" "}
                  <span className="muted">
                    Scored by AI after the images were made (does each image fit
                    the post, is it clear on a phone, is the design good)
                    {post.score.redone
                      ? `; ${post.score.redone} redone after the first score`
                      : ""}
                    . Hook {post.score.hook}/100: {post.score.hookWhy}
                  </span>
                </p>
              ) : (
                <p className="muted small">
                  Not scored: the AI wasn&apos;t available when these were made.
                </p>
              )}
              <div className="gw-assets">
                {mine.map((a) => (
                  <a
                    key={a.id}
                    className="gw-card"
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    download
                  >
                    <Thumb a={a} />
                    <span className="small">
                      {a.label} · {a.w}×{a.h}
                      {a.designedBy === "ai"
                        ? " · AI design"
                        : a.designedBy === "template"
                          ? " · Template"
                          : ""}
                    </span>
                    {a.score !== undefined && (
                      <span className="small">
                        <Chip tone={scoreTone(a.score)}>{a.score}/100</Chip>{" "}
                        <span className="muted">{a.scoreWhy}</span>
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <span className="muted small">No images yet.</span>
          );
        }}
      </Loaded>
    </div>
  );
}
