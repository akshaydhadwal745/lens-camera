// The written + designed reel, in steps (docs/growth/content-engine.md, phase 4; owner 2026-11-10: quality over
// time). Each step is its own GrowthAnalyst call, so no step meets the Lambda's 15 minutes; they hand over through
// a state file in the content bucket (x/reel-work/<postId>/, deleted with x/ after 30 days):
//   write  → Claude (writer) finds the pain point and writes the reel; photos and footage that fit are found
//   design → Claude (designer) designs every scene; each is drawn at a few moments and checked; one fix round;
//            scenes that still fail use a template scene
//   render → every frame drawn and encoded, Claude scores it, the reel is saved on the post; scenes under 70 go
//            back to design once with the scorer's notes (round 1), then render again
// JOB#reel tracks the whole run; each step checks the row is still its run (a newer Make reel wins).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, s3 } from '../api/lib';
import { playbookFor } from './growth-brain';
import { runClaude, type Mode } from './growth';
import type { KitPhoto } from './growth-ai-design';
import { brand as loadBrand } from './growth-brand';
import { qrPattern, type Screen } from './growth-design';
import { frames, gatherPhotos, IMG, postBrief, topicQuery, type RenderablePost } from './growth-media';
import { FITS, type StockVideo } from './growth-photos';
import { reelHtml, type ReelScene, type SceneMedia } from './growth-reel';
import { designsByScene, readWrittenReel, REEL_DESIGN_SCHEMA, REEL_DESIGN_SYSTEM, REEL_WRITER_SCHEMA, REEL_WRITER_SYSTEM, reelDesignPrompt, reelSceneCheck, reelSceneHtml, sceneWordProblems, writerPrompt, type SceneDesign, type WrittenReel } from './growth-reel-ai';
import { launchBrowser } from './growth-render';
import { clipFrames, decodeMono, drawReel, planCues, rankFootage, reelProgress, renderTemplateReel, SITE, token, WORK } from './growth-video';
import { RATE, type Cue, type VoiceLine } from './growth-sound';
import { fitToVoice, LEAD, speak, stretchMarks, subChunks, VOICE, wordMarks, type SubChunk, type Word } from './growth-voice';

const BUCKET = process.env.GROWTH_CONTENT_BUCKET ?? '';
const REPO = 'akshaydhadwal745/lens-camera';
const WRITER_MODE: Mode = { system: REEL_WRITER_SYSTEM, schema: REEL_WRITER_SCHEMA, toolNames: [], mode: 'report' };
const DESIGN_MODE: Mode = { system: REEL_DESIGN_SYSTEM, schema: REEL_DESIGN_SCHEMA, toolNames: [], mode: 'report' };
const BRAND_DARK = 'radial-gradient(60% 40% at 85% 20%,#2563eb 0%,transparent 70%),radial-gradient(60% 45% at 10% 85%,#7c3aed 0%,transparent 70%),#0b1020';
const REDO_BELOW = 70;

export type ReelStep = 'write' | 'design' | 'render';
type Post = RenderablePost & { title: string; assets?: { id: string; role: string }[] };
type State = {
  v: 1;
  postId: string;
  by: string;
  jobAt: number;
  round: 0 | 1;
  written: WrittenReel;
  allowed: string; // words that may appear (post + product facts), for the word checks
  photos: { ref: string; id: string; about: string; w: number; h: number }[]; // photos that fit, saved under work/p/
  pool: string[]; // photo ids for phone screens and tiles
  stills: Record<number, string>; // scene n → photo id (photo scenes, and footage scenes without a clip)
  clips: Record<number, StockVideo>; // scene n → clip
  credited: { id: string; role: string }[];
  designs: Record<number, SceneDesign>;
  failed: number[]; // scenes drawn from a template
  notes?: Record<number, string[]>; // the scorer's notes for scenes to redesign
  voice?: { name: string; lines: Record<number, number>; words?: Record<number, Word[]> }; // scene n → spoken seconds (work/vo/<n>.mp3)
};

/** Mood b-roll searches (Pixabay video), tried when a footage scene's own searches find nothing. */
export const MOOD_BROLL: Record<string, string[]> = {
  upbeat: ['confetti celebration', 'crowd hands up'],
  energetic: ['concert crowd lights', 'stage lights'],
  warm: ['fairy lights bokeh', 'hands holding phone'],
  emotional: ['stage spotlight', 'candles bokeh'],
  chill: ['city night lights', 'sunset timelapse'],
};

const workKey = (postId: string, f: string) => `x/reel-work/${postId}/${f}`;
const putWork = (postId: string, f: string, body: Buffer | string, type: string) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: workKey(postId, f), Body: body, ContentType: type }));
async function getWork(postId: string, f: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: workKey(postId, f) }));
  return Buffer.from(await r.Body!.transformToByteArray());
}
const saveState = (st: State) => putWork(st.postId, 'state.json', JSON.stringify(st), 'application/json');
const loadState = async (postId: string) => JSON.parse((await getWork(postId, 'state.json')).toString()) as State;

async function jobRow() {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'JOB#reel' } }))).Item;
}

/** The next step, as a fresh call of this function (the Lambda calls itself; its role may). */
async function next(postId: string, step: ReelStep, jobAt: number, by: string) {
  const { InvokeCommand, LambdaClient } = await import('@aws-sdk/client-lambda');
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ reel: { postId, step, jobAt }, by })) }));
}

/** The product facts the writer may claim (public repo, current main); empty when GitHub doesn't answer. */
async function productFacts(): Promise<string> {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/docs/growth/product-facts.md`, { signal: AbortSignal.timeout(15_000) });
    return r.ok ? (await r.text()).slice(0, 8000) : '';
  } catch {
    return '';
  }
}

const loadPost = async (postId: string) => {
  const post = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` } }))).Item as Post | undefined;
  if (!post) throw new Error(`Post ${postId} is gone`);
  return { ...post, id: postId, slides: post.slides ?? [], script: post.script ?? [], variants: post.variants ?? {} } as Post;
};

/** A template scene for a written scene, when its design fails (or for the plan the template path draws). */
function templateScene(s: WrittenReel['scenes'][number], last: boolean, topic: string): ReelScene {
  if (last) return { type: 'end', seconds: s.seconds, text: s.words, screen: s.screen };
  if (s.media === 'footage' || s.media === 'photo') return { type: 'footage', seconds: s.seconds, text: s.words, screen: s.screen, query: s.query || topic };
  return { type: 'phone', seconds: s.seconds, text: s.words, screen: s.screen as Screen };
}

/**
 * Entry from growth-run.ts. Returns continued: true while later steps will finish the job (they call
 * finishJob through the same entry), so the caller must not mark the job done.
 */
export async function renderReel(postId: string, by: string, step: ReelStep = 'write', jobAtIn?: number): Promise<{ continued: boolean }> {
  if (!BUCKET) throw new Error('Content storage isn’t set up');
  const row = await jobRow();
  const jobAt = jobAtIn ?? Number(row?.startedAt ?? Date.now());
  if (row && Number(row.startedAt) !== jobAt) {
    console.log(JSON.stringify({ reelSuperseded: postId, step }));
    return { continued: true }; // a newer run owns the job row
  }
  if (step === 'write') return writeStep(postId, by, jobAt);
  if (step === 'design') return designStep(postId, jobAt);
  return renderStep(postId, jobAt);
}

/**
 * The voiceover: every scene's line spoken by the reel's voice, saved to work/vo/<n>.mp3, and the scenes stretched
 * to fit their lines (before they are designed, so the motion is timed to the voice). No voice → a silent-voice
 * reel as before (music and effects only); never fails the reel.
 */
async function recordVoice(postId: string, written: WrittenReel): Promise<State['voice']> {
  const lines: Record<number, number> = {};
  const words: Record<number, Word[]> = {};
  try {
    for (const s of written.scenes) {
      if (!s.vo) continue;
      const mp3 = await speak(s.vo, VOICE);
      const file = join(WORK, `vo-${s.n}.mp3`);
      writeFileSync(file, mp3);
      lines[s.n] = Math.round(((await decodeMono(file)).length / RATE) * 100) / 100;
      await putWork(postId, `vo/${s.n}.mp3`, mp3, 'audio/mpeg');
      // Word times for the subtitles (a line without them just has no subtitles).
      try {
        const nm = await wordMarks(s.vo, VOICE);
        const nf = join(WORK, `vo-${s.n}-n.mp3`);
        writeFileSync(nf, nm.audio);
        words[s.n] = stretchMarks(nm.marks, (await decodeMono(nf)).length / RATE, lines[s.n]);
      } catch (e) {
        console.error(JSON.stringify({ wordMarksFailed: s.n, message: (e as Error).message.slice(0, 200) }));
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ voiceFailed: (e as Error).message.slice(0, 300) }));
    return undefined;
  }
  if (!Object.keys(lines).length) return undefined;
  const fitted = fitToVoice(written.scenes, new Map(Object.entries(lines).map(([n, v]) => [Number(n), v])));
  written.scenes.forEach((s, i) => (s.seconds = fitted[i]));
  console.log(JSON.stringify({ reelVoice: { voice: VOICE, lines, seconds: fitted } }));
  return { name: VOICE, lines, words };
}

/** The voiceover's subtitles on the reel's timeline. */
function subtitles(st: State): SubChunk[] {
  if (!st.voice?.words) return [];
  const out: SubChunk[] = [];
  let at = 0;
  for (const s of st.written.scenes) {
    const w = st.voice.words[s.n];
    if (w?.length) out.push(...subChunks(w, at + LEAD, st.voice.lines[s.n] ?? 0));
    at += s.seconds;
  }
  return out;
}

/** The saved voice lines on the reel's timeline. */
async function voiceLines(st: State): Promise<VoiceLine[]> {
  if (!st.voice) return [];
  const out: VoiceLine[] = [];
  let at = 0;
  for (const s of st.written.scenes) {
    if (st.voice.lines[s.n]) {
      try {
        const file = join(WORK, `vo-${s.n}.mp3`);
        writeFileSync(file, await getWork(st.postId, `vo/${s.n}.mp3`));
        out.push({ at: at + LEAD, pcm: await decodeMono(file) });
      } catch (e) {
        console.error(JSON.stringify({ voiceLineFailed: s.n, message: (e as Error).message.slice(0, 200) }));
      }
    }
    at += s.seconds;
  }
  return out;
}

async function writeStep(postId: string, by: string, jobAt: number): Promise<{ continued: boolean }> {
  const progress = reelProgress(jobAt);
  progress('writing');
  const tok = await token();
  if (!tok) {
    await renderTemplateReel(postId, by, jobAt);
    return { continued: false };
  }
  const post = await loadPost(postId);
  const brand = await loadBrand();
  const cta = brand.ctas[0] ?? 'Try Lens free';
  const facts = await productFacts();
  const brief = postBrief(post);
  const script = (post.script ?? []).map((s) => String(s.onScreen ?? '')).filter(Boolean);
  const allowed = `${brief} ${script.join(' ')} ${facts}`;
  // What real results taught us (the brain's playbook; empty until there is one).
  const learned = await playbookFor('writer');
  let written: WrittenReel | undefined;
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2 && !written; attempt++) {
    try {
      const prompt = writerPrompt(brief, script, facts, cta, brand.voice ?? '') + learned + (problems.length ? `\n\nYOUR LAST VERSION WAS REJECTED: ${problems.join('; ')}. Write it again.` : '');
      const { report } = await runClaude<Partial<WrittenReel>>(prompt, tok, { enabled: [] }, Date.now() + 3 * 60_000, WRITER_MODE);
      const r = readWrittenReel(report, allowed, cta);
      written = r.reel;
      problems = r.problems;
      console.log(JSON.stringify({ reelWritten: r.reel ? { angle: r.reel.angle, hook: r.reel.hook, scenes: r.reel.scenes.map((x) => `${x.media}: ${x.words}`) } : null, problems }));
    } catch (e) {
      problems = [(e as Error).message.slice(0, 200)];
      console.error(JSON.stringify({ reelWriterFailed: problems[0] }));
      break;
    }
  }
  if (!written) {
    await renderTemplateReel(postId, by, jobAt);
    return { continued: false };
  }

  // Photos and footage that fit, searched with the writer's words for each scene.
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const browser = await launchBrowser();
  try {
    progress('photos');
    const topic = topicQuery(`${post.title} ${post.hook}`);
    const queries = [...new Set([...written.scenes.filter((s) => s.media === 'photo' || s.media === 'footage').flatMap((s) => [s.query, s.alt ?? '']).filter(Boolean), topic])];
    const list = frames(post, cta);
    const g = await gatherPhotos(post, list, browser, { queries });
    const idOf = (u: string) => u.slice(IMG.length);
    for (const [id, f] of g.served) await putWork(postId, `p/${id}.jpg`, f.body, f.mime);
    const photos = g.kit.map((k) => ({ ref: k.ref, id: idOf(k.url), about: k.about, w: k.w, h: k.h }));
    const stills: Record<number, string> = {};
    for (const s of written.scenes) {
      const u = (s.query && g.scenes.get(s.query)) || (s.alt && g.scenes.get(s.alt)) || g.scenes.get(topic);
      if ((s.media === 'photo' || s.media === 'footage') && u) stills[s.n] = idOf(u);
    }
    progress('footage');
    const clips: Record<number, StockVideo> = {};
    const used = new Set<string>();
    const ranked = new Map<string, StockVideo[]>();
    for (const s of written.scenes.filter((x) => x.media === 'footage')) {
      // The writer's search, then its broader one, then the post's topic: an editor keeps looking.
      let clip: StockVideo | undefined;
      for (const q of [...new Set([s.query, s.alt, topic].filter((x): x is string => !!x))]) {
        if (!ranked.has(q)) ranked.set(q, await rankFootage(q, postBrief(post) + `\nThis scene: ${s.words} (${s.beat})`, browser));
        clip = ranked.get(q)!.find((v) => !used.has(v.id));
        if (clip) break;
      }
      // Still nothing: mood b-roll an editor would cut in (moving light, crowds, hands), a little looser on fit.
      for (const q of MOOD_BROLL[written.mood ?? 'upbeat'] ?? []) {
        if (clip) break;
        const k = `broll:${q}`;
        if (!ranked.has(k)) ranked.set(k, await rankFootage(q, postBrief(post) + `\nThis scene: ${s.words} (${s.beat}). Mood shot: it only has to carry the feeling, not show the exact event.`, browser, FITS - 1));
        clip = ranked.get(k)!.find((v) => !used.has(v.id));
      }
      if (clip) {
        used.add(clip.id);
        clips[s.n] = clip;
      }
    }
    progress('voice');
    const voice = await recordVoice(postId, written);
    const st: State = { v: 1, postId, by, jobAt, round: 0, written, allowed, photos, pool: g.pool.map(idOf), stills, clips, credited: g.credited, designs: {}, failed: [], ...(voice ? { voice } : {}) };
    await saveState(st);
    console.log(JSON.stringify({ reelMedia: { photos: photos.length, stills, clips: Object.fromEntries(Object.entries(clips).map(([n, c]) => [n, c.id])) } }));
  } finally {
    await browser.close();
  }
  await next(postId, 'design', jobAt, by);
  return { continued: true };
}

/** Photos of the run under WORK/p/<id>.jpg, as the page references them. */
async function fetchPhotos(st: State) {
  mkdirSync(join(WORK, 'p'), { recursive: true });
  const ids = new Set([...st.photos.map((p) => p.id), ...st.pool, ...Object.values(st.stills)]);
  for (const id of ids) writeFileSync(join(WORK, 'p', `${id}.jpg`), await getWork(st.postId, `p/${id}.jpg`).catch(() => Buffer.alloc(0)));
}
const kitOf = (st: State): KitPhoto[] => st.photos.map((p) => ({ ref: p.ref, url: `p/${p.id}.jpg`, about: p.about, w: p.w, h: p.h }));

/** The page's scenes: designed ones expanded with their media, template ones for the rest. */
function scenesOf(st: State, icon: string, clipFramesOf: Record<number, number>): { plan: ReelScene[]; media: SceneMedia[]; designed: (Cue[] | undefined)[] } {
  const topic = st.written.scenes.find((s) => s.query)?.query ?? '';
  const n = st.written.scenes.length;
  const qr = qrPattern(7);
  const pool = st.pool.map((id) => `p/${id}.jpg`);
  const plan: ReelScene[] = [];
  const media: SceneMedia[] = [];
  const designed: (Cue[] | undefined)[] = [];
  for (const s of st.written.scenes) {
    const i = s.n - 1;
    const d = st.designs[s.n];
    const still = st.stills[s.n] ? `p/${st.stills[s.n]}.jpg` : undefined;
    const frames = clipFramesOf[s.n];
    const t = templateScene(s, s.n === n, topic);
    if (d && !st.failed.includes(s.n)) {
      const html = reelSceneHtml(d.html, { photos: kitOf(st), pool, icon, clip: frames ? { dir: `f/${i}`, frames } : undefined, still, qr, brandDark: BRAND_DARK });
      plan.push({ ...t, ai: { html, entry: d.entry } });
      media.push({});
      designed.push(d.sounds ?? []);
    } else {
      // A template footage scene: its clip, else its photo, else the app on a phone.
      if (t.type === 'footage' && !frames && !still) plan.push({ ...t, type: 'phone' });
      else plan.push(t);
      media.push(frames ? { frames } : still ? { still } : {});
      designed.push(undefined);
    }
  }
  return { plan, media, designed };
}

const font = (name: string) => readFileSync(join(process.env.GROWTH_BRAND_DIR ?? join(__dirname, 'brand'), name)).toString('base64');

async function designStep(postId: string, jobAt: number): Promise<{ continued: boolean }> {
  const progress = reelProgress(jobAt);
  const st = await loadState(postId);
  const redo = st.round === 1 && st.notes ? new Map(Object.entries(st.notes).map(([k, v]) => [Number(k), v])) : undefined;
  progress(redo ? 'improving' : 'designing');
  const tok = await token();
  const brand = await loadBrand();
  const colours = { primary: brand.colors.primary, accent: brand.colors.accent };
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  await fetchPhotos(st);
  const icon = `data:image/png;base64,${font('lens-icon.png')}`;
  const footage = new Set(Object.keys(st.clips).map(Number));
  const ask = async (fix?: Map<number, string[]>) => {
    if (!tok) return new Map<number, SceneDesign>();
    try {
      const { report } = await runClaude<{ scenes: Partial<SceneDesign>[] }>(reelDesignPrompt(st.written, kitOf(st), footage, colours, SITE, fix) + (await playbookFor('designer')), tok, { enabled: [] }, Date.now() + 7 * 60_000, DESIGN_MODE);
      return designsByScene(report, st.written.scenes.length, (n) => st.written.scenes[n - 1]?.seconds ?? 5);
    } catch (e) {
      console.error(JSON.stringify({ reelDesignFailed: (e as Error).message.slice(0, 300) }));
      return new Map<number, SceneDesign>();
    }
  };
  const got = await ask(redo);
  for (const [n, d] of got) {
    st.designs[n] = d;
    st.failed = st.failed.filter((x) => x !== n);
  }
  // Scenes nobody designed use their template.
  for (const s of st.written.scenes) if (!st.designs[s.n] && !st.failed.includes(s.n)) st.failed.push(s.n);

  // Draw each designed scene at a few moments and check it; one fix round for the ones that fail.
  progress('checking');
  const browser = await launchBrowser();
  try {
    const check = async (only?: Set<number>) => {
      const { plan, media } = scenesOf(st, icon, {});
      const html = reelHtml({ brand: colours, scenes: plan, media, pool: st.pool.map((id) => `p/${id}.jpg`), icon, fonts: { geist: font('geist-latin.woff2'), plex500: font('plex-mono-500.ttf'), plex600: font('plex-mono-600.ttf') }, cta: brand.ctas[0] ?? 'Try Lens free', site: SITE });
      writeFileSync(join(WORK, 'check.html'), html);
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
      await page.setRequestInterception(true);
      page.on('request', (r: { url(): string; continue(): Promise<void>; abort(): Promise<void> }) => void (/^(file|data|about):/.test(r.url()) ? r.continue() : r.abort()));
      await page.goto(`file://${WORK}/check.html`, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready');
      const problems = new Map<number, string[]>();
      let at = 0;
      for (const s of st.written.scenes) {
        const start = at;
        at += s.seconds;
        if (st.failed.includes(s.n) || (only && !only.has(s.n))) continue;
        const found: string[] = [];
        for (const k of [Math.min(1.2, s.seconds * 0.45), s.seconds * 0.7, s.seconds * 0.95]) {
          await page.evaluate(`seek(${start + k})`);
          const r = (await page.evaluate(reelSceneCheck(s.n - 1, s.n === st.written.scenes.length, k >= s.seconds * 0.7))) as { problems: string[]; text: string };
          found.push(...r.problems);
          if (k >= s.seconds * 0.7) found.push(...sceneWordProblems(r.text, s.words, st.allowed));
        }
        if (found.length) problems.set(s.n, [...new Set(found)].slice(0, 8));
      }
      await page.close();
      return problems;
    };
    let problems = await check();
    console.log(JSON.stringify({ reelCheck: Object.fromEntries(problems) }));
    if (problems.size && tok) {
      const fixed = await ask(problems);
      for (const [n, d] of fixed) st.designs[n] = d;
      problems = await check(new Set(problems.keys()));
      console.log(JSON.stringify({ reelCheckAfterFix: Object.fromEntries(problems) }));
    }
    for (const n of problems.keys()) if (!st.failed.includes(n)) st.failed.push(n);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ reelDesigned: st.written.scenes.map((s) => ({ n: s.n, by: st.failed.includes(s.n) ? 'template' : 'ai', idea: st.designs[s.n]?.idea })) }));
  await saveState(st);
  await next(postId, 'render', jobAt, st.by);
  return { continued: true };
}

async function renderStep(postId: string, jobAt: number): Promise<{ continued: boolean }> {
  const began = Date.now();
  const progress = reelProgress(jobAt);
  const st = await loadState(postId);
  const post = await loadPost(postId);
  const brand = await loadBrand();
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  await fetchPhotos(st);
  progress('footage');
  const framesOf: Record<number, number> = {};
  for (const [n, clip] of Object.entries(st.clips)) {
    const s = st.written.scenes.find((x) => x.n === Number(n));
    if (!s) continue;
    const got = await clipFrames(clip, s.n - 1, s.seconds).catch((e) => {
      console.error(JSON.stringify({ clipFailed: clip.id, message: (e as Error).message.slice(0, 300) }));
      return 0;
    });
    if (got) framesOf[s.n] = got;
  }
  const icon = `data:image/png;base64,${font('lens-icon.png')}`;
  const { plan, media, designed } = scenesOf(st, icon, framesOf);
  const browser = await launchBrowser();
  let result;
  try {
    const written = st.written;
    result = await drawReel({
      browser,
      plan,
      media,
      pool: st.pool.map((id) => `p/${id}.jpg`),
      postId,
      post,
      by: st.by,
      brief: `${postBrief(post)}\nThe reel's angle: ${written.angle}\nFor: ${written.audience}`,
      credited: st.credited,
      began,
      progress,
      brand: { primary: brand.colors.primary, accent: brand.colors.accent },
      cta: brand.ctas[0] ?? 'Try Lens free',
      cues: planCues(plan, designed),
      mood: written.mood,
      voice: await voiceLines(st),
      subs: subtitles(st),
      extra: { mood: written.mood ?? null, angle: written.angle, audience: written.audience, hook: written.hook, voiceName: st.voice ? st.voice.name : null, scenes: written.scenes.map((s) => ({ words: s.words, ...(st.voice?.lines[s.n] ? { vo: s.vo } : {}), seconds: s.seconds, shows: s.media, idea: st.designs[s.n]?.idea ?? '', by: st.failed.includes(s.n) ? 'template' : 'ai' })), round: st.round, at: Date.now() },
    });
  } finally {
    await browser.close();
    rmSync(WORK, { recursive: true, force: true });
  }
  // One more round for weak scenes, with the scorer's notes.
  const weak = new Map<number, string[]>();
  for (const [i, sc] of (result.score?.images ?? []).entries()) if (sc.score < REDO_BELOW) weak.set(i + 1, [`the reviewer scored it ${sc.score}/100: ${sc.why}`, sc.fix ? `do this: ${sc.fix}` : ''].filter(Boolean));
  if (st.round === 0 && weak.size && (await token())) {
    st.round = 1;
    st.notes = Object.fromEntries(weak);
    // Template scenes that scored low get a fresh design attempt too.
    st.failed = st.failed.filter((n) => !weak.has(n));
    await saveState(st);
    console.log(JSON.stringify({ reelRedo: [...weak.keys()], total: result.score?.total }));
    await next(postId, 'design', jobAt, st.by);
    return { continued: true };
  }
  return { continued: false };
}
