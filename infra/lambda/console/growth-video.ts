// The reel job (docs/growth/content-engine.md, phase 4): Claude directs the post's script (growth-reel.ts), real
// footage comes from Pixabay and Claude looks at it first, headless Chromium draws every frame, ffmpeg encodes
// H.264 + AAC at 1080×1920 (accepted by Instagram, Facebook and X). No music yet: the audio track is silent.
// Footage isn't kept: e/v<id>.json records what Pixabay said about each clip and its licence, when we used it.
//   GROWTH / ASSET#<id>   the reel (kind render, mime video/mp4, label Reel), file a/<id>.mp4, replaced on each run
//   GROWTH / POST#<id>    reel { assetId, seconds, at }, reelScore (same shape as score)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, HttpError, json, Res, s3 } from '../api/lib';
import { runClaude, type Mode } from './growth';
import type { Asset } from './growth-assets';
import { brand as loadBrand } from './growth-brand';
import { frames, gatherPhotos, LOOK_MODE, postBrief, renderAssetId, scoreImages, topicQuery, writeSheet, type RenderablePost } from './growth-media';
import { FITS, pixabayKey, postTotal, sheetPrompt, sheetVerdicts, videoResults, type PostScore, type StockVideo } from './growth-photos';
import { defaultPlan, DIRECTOR_SCHEMA, DIRECTOR_SYSTEM, directorPrompt, FPS, readPlan, reelHtml, type ReelScene, type SceneMedia } from './growth-reel';
import { launchBrowser } from './growth-render';

const BUCKET = process.env.GROWTH_CONTENT_BUCKET ?? '';
const BRAND_DIR = process.env.GROWTH_BRAND_DIR ?? join(__dirname, 'brand');
const WORK = '/tmp/reel';
const SITE = 'lens.instagrowapp.com';
const LIMIT_MS = 13.5 * 60_000; // the Lambda stops at 15
const DIRECTOR_MODE: Mode = { system: DIRECTOR_SYSTEM, schema: DIRECTOR_SCHEMA, toolNames: [], mode: 'report' };
const NEEDS_CLIP = ['footage', 'qr-card', 'scan'];

function run(cmd: string, args: string[], input?: (stdin: NodeJS.WritableStream) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr!.on('data', (d) => (err = (err + d).slice(-500)));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err}`))));
    if (input)
      void input(child.stdin!).catch((e) => {
        child.kill('SIGKILL');
        reject(e);
      });
  });
}

const token = async () => (process.env.GROWTH_AI_DESIGN === 'off' ? undefined : await getParam('/lens/growth/claude-token').catch(() => undefined));

async function searchVideos(query: string): Promise<StockVideo[]> {
  const key = await pixabayKey();
  if (!key) return [];
  const r = await fetch(`https://pixabay.com/api/videos/?${new URLSearchParams({ key, q: query.slice(0, 100), per_page: '30', order: 'popular', safesearch: 'true' })}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`pixabay videos ${r.status}`);
  return videoResults(await r.json());
}

/** Clips for a search, best first: Claude looks at a frame of each with the post in mind. No answer, no clip. */
export async function rankFootage(query: string, brief: string, browser: Awaited<ReturnType<typeof launchBrowser>>): Promise<StockVideo[]> {
  const tok = await token();
  if (!tok) return [];
  try {
    const found = (await searchVideos(query)).slice(0, 12);
    if (!found.length) return [];
    const thumbs = await Promise.all(found.map(async (v) => `data:image/jpeg;base64,${Buffer.from(await (await fetch(v.thumb, { signal: AbortSignal.timeout(20_000) })).arrayBuffer()).toString('base64')}`));
    const page = await browser.newPage();
    const file = await writeSheet(page, thumbs, `clips-${query.replace(/\W+/g, '-').slice(0, 30)}`).finally(() => page.close());
    const { report } = await runClaude<{ photos: { n: number; ok: boolean; fit: number; why: string }[] }>(sheetPrompt(file, brief, found.map(() => query)), tok, { enabled: [] }, Date.now() + 2.5 * 60_000, LOOK_MODE);
    const verdicts = sheetVerdicts(report, found.length);
    console.log(JSON.stringify({ footageLook: query, clips: found.map((v, i) => ({ id: v.id, ...verdicts.get(i) })) }));
    return found
      .map((v, i) => ({ v, r: verdicts.get(i) }))
      .filter((x) => x.r?.ok && x.r.fit >= FITS)
      .sort((a, b) => (b.r?.fit ?? 0) - (a.r?.fit ?? 0))
      .map((x) => x.v);
  } catch (e) {
    console.error(JSON.stringify({ footageFailed: query, message: (e as Error).message.slice(0, 300) }));
    return [];
  }
}

/** One scene's footage as numbered frames at the reel's size and speed; a short clip loops. */
async function clipFrames(v: StockVideo, sceneIndex: number, seconds: number): Promise<number> {
  const file = join(WORK, `v${v.id}.mp4`);
  if (!existsSync(file)) {
    const r = await fetch(v.url, { signal: AbortSignal.timeout(90_000) });
    if (!r.ok) throw new Error(`clip ${v.id}: ${r.status}`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `e/v${v.id}.json`, ContentType: 'application/json', Body: JSON.stringify({ takenAt: new Date().toISOString(), ...v, license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/' }, null, 2) }));
  }
  const dir = join(WORK, 'f', String(sceneIndex));
  mkdirSync(dir, { recursive: true });
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-stream_loop', '-1', '-i', file, '-t', String(seconds + 0.7), '-vf', "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920:flags=lanczos,fps=30", '-q:v', '3', join(dir, '%04d.jpg')]);
  return readdirSync(dir).length;
}

/** The compare scene's two pictures: the sharp photo, and the same photo as a messaging app would send it. */
async function compareStills(src: string, i: number): Promise<{ hero: string; heroChat: string }> {
  const crop = "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'";
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', join(WORK, src), '-vf', `${crop},scale=1080:1920:flags=lanczos`, '-q:v', '2', join(WORK, `hero${i}.jpg`)]);
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', join(WORK, `hero${i}.jpg`), '-vf', 'scale=180:320', '-q:v', '24', join(WORK, `low${i}.jpg`)]);
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', join(WORK, `low${i}.jpg`), '-vf', 'scale=1080:1920:flags=bilinear', '-q:v', '5', join(WORK, `chat${i}.jpg`)]);
  return { hero: `hero${i}.jpg`, heroChat: `chat${i}.jpg` };
}

/** Where a reel is (on JOB#reel, read by GET /growth/jobs): a stage, and n of total where it counts. */
export type ReelStage = 'photos' | 'directing' | 'footage' | 'frames' | 'scoring' | 'saving';
function reelProgress(began: number) {
  let last = 0;
  let lastStage = '';
  return (stage: ReelStage, step = 0, steps = 0) => {
    const now = Date.now();
    // A new stage is written at once; counts at most every 3 s (frames are drawn ~10 a second).
    if (stage === lastStage && step < steps && now - last < 3000) return;
    last = now;
    lastStage = stage;
    void ddb
      .send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'JOB#reel' }, UpdateExpression: 'SET stage = :s, step = :n, steps = :t, stageAt = :a', ConditionExpression: 'startedAt <= :b', ExpressionAttributeValues: { ':s': stage, ':n': step, ':t': steps, ':a': now, ':b': began } }))
      .catch(() => undefined);
  };
}

export async function renderReel(postId: string, by: string): Promise<{ seconds: number; ms: number }> {
  const began = Date.now();
  if (!BUCKET) throw new Error('Content storage isn’t set up');
  const post = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` } }))).Item as (RenderablePost & { title: string }) | undefined;
  if (!post) throw new Error(`Post ${postId} is gone`);
  const brand = await loadBrand();
  const cta = brand.ctas[0] ?? 'Try Lens free';
  const shaped = { ...post, id: postId, slides: post.slides ?? [], script: post.script ?? [], variants: post.variants ?? {} };
  const list = frames(shaped, cta);
  const brief = [postBrief(shaped), ...(post.script ?? []).map((s) => `Scene: ${s.onScreen}`)].join('\n').slice(0, 2500);
  const topic = list.find((f) => f.query)?.query ?? topicQuery(`${post.title} ${post.hook}`);
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, 'p'), { recursive: true });
  const progress = reelProgress(began);
  progress('directing');
  const browser = await launchBrowser();
  try {
    // 1) Claude directs; the words and timing stay the script's.
    let plan: ReelScene[] = defaultPlan(shaped, topic, cta);
    const tok = await token();
    if (tok) {
      progress('directing');
      try {
        const { report } = await runClaude<{ scenes: { n: number; type: string; screen: string; query: string }[] }>(directorPrompt(brief, plan), tok, { enabled: [] }, Date.now() + 2 * 60_000, DIRECTOR_MODE);
        plan = readPlan(report, plan, topic);
      } catch (e) {
        console.error(JSON.stringify({ directorFailed: (e as Error).message.slice(0, 300) }));
      }
    }

    // 2) Photos from the scenes' own searches (and the post's topic), only ones Claude says fit the post; Pixabay
    // first, then credited sources. No fitting photo → brand background, never unrelated scenery.
    progress('photos');
    const searches = [...new Set([...plan.map((sc) => sc.query).filter((q): q is string => !!q), topic])];
    const { served, pool, scenes: scenePhotos, credited } = await gatherPhotos(shaped, list, browser, { queries: searches });
    const local = (u: string) => `p/${u.split('/').pop()}.jpg`;
    for (const [id, f] of served) writeFileSync(join(WORK, 'p', `${id}.jpg`), f.body);
    const stillFor = (q?: string) => {
      const u = (q && scenePhotos.get(q)) ?? scenePhotos.get(topic) ?? [...scenePhotos.values()][0];
      return u ? local(u) : undefined;
    };

    // 3) Footage, a different clip per scene where there are enough. A scene with nothing to show becomes the phone.
    const ranked = new Map<string, StockVideo[]>();
    const used = new Set<string>();
    const media: SceneMedia[] = [];
    for (let i = 0; i < plan.length; i++) {
      progress('footage', i, plan.length);
      const sc = plan[i];
      if (NEEDS_CLIP.includes(sc.type)) {
        const q = sc.query ?? topic;
        if (!ranked.has(q)) ranked.set(q, await rankFootage(q, brief, browser));
        const options = ranked.get(q)!;
        const clip = options.find((v) => !used.has(v.id)) ?? options[0];
        let m: SceneMedia = {};
        if (clip) {
          used.add(clip.id);
          m = { frames: await clipFrames(clip, i, sc.seconds).catch((e) => {
            console.error(JSON.stringify({ clipFailed: clip.id, message: (e as Error).message.slice(0, 300) }));
            return undefined;
          }) };
        }
        const still = m.frames ? undefined : stillFor(sc.query);
        if (still) m = { still };
        // Opening footage with nothing that fits → the app on a phone; qr-card/scan keep their scene on a brand background.
        if (!m.frames && !m.still && sc.type === 'footage') plan[i] = { ...sc, type: 'phone' };
        media.push(m);
      } else if (sc.type === 'compare') {
        const still = stillFor(sc.query);
        if (still) media.push(await compareStills(still, i));
        else {
          plan[i] = { ...sc, type: 'phone', screen: 'viewer' };
          media.push({});
        }
      } else media.push({});
    }
    console.log(JSON.stringify({ reelPlan: plan.map((s, i) => ({ type: s.type, seconds: s.seconds, query: s.query, frames: media[i].frames })) }));

    // 4) Every frame, one by one (nothing leaves the page).
    const font = (n: string) => readFileSync(join(BRAND_DIR, n)).toString('base64');
    const html = reelHtml({ scenes: plan, media, pool: pool.map(local), icon: `data:image/png;base64,${font('lens-icon.png')}`, fonts: { geist: font('geist-latin.woff2'), plex500: font('plex-mono-500.ttf'), plex600: font('plex-mono-600.ttf') }, cta, site: SITE });
    writeFileSync(join(WORK, 'reel.html'), html);
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (r: { url(): string; continue(): Promise<void>; abort(): Promise<void> }) => void (/^(file|data|about):/.test(r.url()) ? r.continue() : r.abort()));
    await page.goto(`file://${WORK}/reel.html`, { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready');
    const seconds = Math.round(plan.reduce((a, s) => a + s.seconds, 0) * 10) / 10;
    const total = Math.round(seconds * FPS);
    const out = join(WORK, 'reel.mp4');
    await run(
      'ffmpeg',
      ['-nostdin', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out],
      async (stdin) => {
        for (let i = 0; i < total; i++) {
          progress('frames', i, total);
          if (Date.now() - began > LIMIT_MS) throw new Error('The reel took too long to draw. Try a shorter script.');
          await page.evaluate(`seek(${i / FPS})`);
          const jpg = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 95 }));
          if (!stdin.write(jpg)) await new Promise((r) => stdin.once('drain', r));
        }
        stdin.end();
      },
    );

    // 5) Claude scores what came out: one frame late in each scene, once its motion has landed.
    progress('scoring');
    const shots: { label: string; png: Buffer }[] = [];
    let at = 0;
    for (let i = 0; i < plan.length; i++) {
      await page.evaluate(`seek(${at + plan[i].seconds * 0.85})`);
      shots.push({ label: `Scene ${i + 1}: ${plan[i].text}`.slice(0, 120), png: Buffer.from(await page.screenshot({ type: 'png' })) });
      at += plan[i].seconds;
    }
    let score: PostScore | null = null;
    if (Date.now() - began < 13 * 60_000) {
      const sheetPage = await browser.newPage();
      const s = await scoreImages(sheetPage, shots, brief).finally(() => sheetPage.close());
      if (s) score = { total: postTotal(s.images, s.hook), hook: s.hook, hookWhy: s.hookWhy, images: s.images, redone: 0, at: Date.now() };
    }

    // 6) Save.
    progress('saving');
    const body = readFileSync(out);
    const id = renderAssetId(postId, 'Reel');
    const key = `a/${id}.mp4`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'video/mp4' }));
    const asset: Asset & { postId: string; label: string; w: number; h: number; seconds: number; score?: number; scoreWhy?: string } = {
      id,
      name: `${post.title || 'Post'} · Reel`.slice(0, 160),
      kind: 'render',
      origin: 'template',
      key,
      mime: 'video/mp4',
      bytes: body.length,
      lensPhoto: false,
      checkedPersonal: true,
      rights: { status: 'cleared', license: 'own', licenseUrl: '', source: '', author: '', credit: '', commercialOk: true, editsOk: true, peopleOrBrands: false, reason: credited.length ? 'Made by Lens; footage from Pixabay, photos from Pixabay and free-licence sites, credited in the post; looked at by AI first. Look at it when you approve the post.' : 'Made by Lens; footage and photos from Pixabay (Pixabay Content License, no credit needed), looked at by AI first. Look at it when you approve the post.', checkedAt: Date.now(), checkedBy: 'template' },
      status: 'ready',
      createdAt: Date.now(),
      createdBy: by,
      postId,
      label: 'Reel',
      w: 1080,
      h: 1920,
      seconds,
      ...(score ? { score: score.total, scoreWhy: score.hookWhy } : {}),
    };
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `ASSET#${id}`, ...asset } }));
    // Credited photos (CC BY from Commons/Openverse) join the post's assets, so Export adds their credit lines.
    const reelAssets = [...(post.assets ?? []), ...credited.filter((c) => !(post.assets ?? []).some((a) => a.id === c.id))].slice(0, 20);
    await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` }, UpdateExpression: 'SET reel = :r, reelScore = :s, assets = :a', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':r': { assetId: id, seconds, at: Date.now() }, ':s': score, ':a': reelAssets } }));
    const ms = Date.now() - began;
    console.log(JSON.stringify({ reelDone: postId, ms, seconds, bytes: body.length, total: score?.total ?? null }));
    return { seconds, ms };
  } finally {
    await browser.close();
    rmSync(WORK, { recursive: true, force: true });
  }
}

const REEL_MINUTES = 14;

/** POST /growth/posts/<id>/reel: one at a time; the Console polls GET /growth/jobs. */
export async function reelStart(postId: string, by: string): Promise<Res> {
  if (!/^[a-f0-9]{10}$/.test(postId)) throw new HttpError(400, 'Bad post id');
  const post = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` } }))).Item;
  if (!post) throw new HttpError(404, 'No such post');
  const job = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'JOB#reel' } }))).Item;
  if (job && !job.finishedAt && Date.now() - job.startedAt < REEL_MINUTES * 60_000) throw new HttpError(409, 'A reel is already being made. Try again when it finishes.');
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'JOB#reel', startedAt: Date.now(), by, postId } }));
  const { InvokeCommand, LambdaClient } = await import('@aws-sdk/client-lambda');
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.GROWTH_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ reel: { postId }, by })) }));
  return json(202, { started: true });
}
