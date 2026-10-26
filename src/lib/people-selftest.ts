// People self-test (docs/design/people.md, build step 2): on a real phone, does
// the face pipeline load (LiteRT from Play services), how fast is it, and does
// it agree with the PC? Uses public-domain photos from our site
// (site/public/people/test, made by research/faces/testphotos.py).
import { Directory, File, Paths } from 'expo-file-system';

import { LensImaging, LensPeople, PeopleBenchmark } from '../../modules/lens-camera';
import { WEB_URL } from './api';

const MODEL = { path: 'people/sface-v1.tflite', size: 9863952, md5: 'b1e69f79361fa65db3113dbccfcba0e5' };
const PHOTOS = ['biden-2021', 'biden-2013', 'obama-2012', 'family-2011'] as const;
/** The grouping check: 10 photos of 4 people (expected.json `groups`: people in >= 3 photos). */
const GROUP_PHOTOS = ['biden-2009', 'biden-2013', 'biden-2021', 'family-2011', 'family-green', 'harris-photo', 'harris-senate', 'harris-vp', 'michelle-2013', 'obama-2012'] as const;
/** Same-person thresholds (LFW 6000 pairs, research/faces/spike.py): auto-group / ask. */
export const PEOPLE_MERGE = 0.45;
export const PEOPLE_MATCH = 0.363;
/** Embedding time per face above this on a phone = too slow for overnight grouping. */
const SLOW_EMBED_MS = 150;

type Expected = { embeddings: Record<string, number[][]>; groups?: string[][] };
export type PeopleCheck = { status: 'pass' | 'warn' | 'fail' | 'skip'; message: string; details?: Record<string, unknown> };

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const best = (a: number[], list: number[][]) => Math.max(-1, ...list.map((b) => dot(a, b)));

/** A failed connection (no network, DNS, timeout), as opposed to an answer from the server. */
export function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /network|timeout|timed out|unable to resolve host|failed to connect|connection|socket|unreachable|ENOTFOUND|ECONN/i.test(m);
}

async function fetchFile(dir: Directory, remote: string, name: string): Promise<File> {
  const f = new File(dir, name);
  // One retry: test-lab racks drop connections now and then.
  for (let attempt = 0; !f.exists; attempt++) {
    try {
      await File.downloadFileAsync(`${WEB_URL}/${remote}`, f);
    } catch (e) {
      if (attempt >= 1 || !isNetworkError(e)) throw e;
    }
  }
  return f;
}

/**
 * People needs two things Google Play services delivers itself (not in the APK): ML Kit's face
 * module and the LiteRT runtime. A phone that hasn't received them yet (test-lab phones often
 * can't download them; dev-152: "Waiting for the face module to be downloaded") waits instead of
 * grouping, and the charging job tries again later. That's not a Lens failure: say so at once.
 */
const WAITING_FOR_PLAY = 'Google Play services hasn’t installed its face module on this phone yet; People starts by itself once it arrives';

export async function peopleSelfTest(): Promise<PeopleCheck> {
  if (!LensPeople) return { status: 'skip', message: 'needs the APK with People (dev-81 or newer)' };
  if (!LensPeople.available()) return { status: 'warn', message: 'no Google Play services: People will be hidden on this phone' };
  if (!WEB_URL) return { status: 'skip', message: 'no website URL in this build' };
  if (LensImaging?.mlModules) {
    const m = await LensImaging.mlModules(false, 15000).catch(() => null);
    const faces = (m?.faces as { state?: string } | undefined)?.state;
    if (faces && faces !== 'present' && faces !== 'downloaded') return { status: 'warn', message: WAITING_FOR_PLAY, details: { faces } };
  }
  try {
    return await groupingCheck();
  } catch (e) {
    if (isNetworkError(e)) return { status: 'warn', message: `test photos couldn’t download on this phone’s network (${e instanceof Error ? e.message : String(e)})` };
    throw e;
  }
}

async function groupingCheck(): Promise<PeopleCheck> {
  if (!LensPeople) return { status: 'skip', message: 'needs the APK with People (dev-81 or newer)' };
  const dir = new Directory(Paths.cache, 'people-selftest');
  if (!dir.exists) dir.create();
  const t0 = Date.now();
  const model = await fetchFile(dir, MODEL.path, 'sface-v1.tflite');
  if (model.size !== MODEL.size || model.md5 !== MODEL.md5) {
    model.delete();
    return { status: 'fail', message: 'face model download is damaged (size/checksum)' };
  }
  const photos = await Promise.all(PHOTOS.map((p) => fetchFile(dir, `people/test/${p}.jpg`, `${p}.jpg`)));
  const expected = JSON.parse(await (await fetchFile(dir, 'people/test/expected.json', 'expected.json')).text()) as Expected;
  const downloadMs = Date.now() - t0;

  const r: PeopleBenchmark = await LensPeople.benchmark(model.uri, photos.map((p) => p.uri));
  // LiteRT also comes from Play services (same wait as the face module above).
  if (!r.ok && r.error === 'LiteRT not available') return { status: 'warn', message: WAITING_FOR_PLAY.replace('its face module', 'the LiteRT runtime'), details: { ...r } };
  if (!r.ok || !r.results) return { status: 'fail', message: r.error ?? 'benchmark failed', details: { ...r } };
  const [b21, b13, o12, fam] = r.results.map((x) => x.embeddings);
  const details: Record<string, unknown> = {
    downloadMs,
    initMs: r.initMs,
    detectMsPerPhoto: r.detectMsPerPhoto,
    embedMsPerFace: r.embedMsPerFace,
    faces: r.results.map((x) => x.faces),
    skipped: r.results.map((x) => x.skipped),
    sharpness: r.results.map((x) => x.sharpness.map((s) => Math.round(s))),
  };
  if (!b21?.length || !b13?.length || !o12?.length) return { status: 'fail', message: 'no face found in a portrait', details };
  const same = dot(b21[0], b13[0]);
  const diff = Math.max(dot(b21[0], o12[0]), dot(b13[0], o12[0]));
  const famScores = (fam ?? []).map((e) => dot(o12[0], e)).sort((a, b) => b - a);
  // Phone (ML Kit landmarks) vs PC (YuNet landmarks) on the same photo: should be near-identical.
  const pc = Math.min(best(b21[0], expected.embeddings['biden-2021']), best(o12[0], expected.embeddings['obama-2012']));
  Object.assign(details, { same, diff, family: famScores, phoneVsPc: pc });

  const problems: string[] = [];
  if (same < PEOPLE_MERGE) problems.push(`same person scored ${same.toFixed(2)}`);
  if (diff >= PEOPLE_MATCH) problems.push(`different people scored ${diff.toFixed(2)}`);
  if (famScores.length !== 4) problems.push(`family photo: ${famScores.length} faces, expected 4`);
  if ((famScores[0] ?? 0) < PEOPLE_MERGE) problems.push('Obama not found in the family photo');
  if ((famScores[1] ?? 0) >= PEOPLE_MATCH) problems.push('a family member was matched to Obama');
  if (pc < 0.9) problems.push(`phone and PC disagree (${pc.toFixed(2)})`);
  // Full grouping (scanner + FaceGroups, same as the charging job) on 10 photos of 4 people.
  if (LensPeople.groupTest && expected.groups) {
    const files = await Promise.all(GROUP_PHOTOS.map((p) => fetchFile(dir, `people/test/${p}.jpg`, `${p}.jpg`)));
    const g = await LensPeople.groupTest(model.uri, files.map((f) => f.uri));
    if (!g.ok || !g.groups) problems.push(`grouping failed: ${g.error ?? '?'}`);
    else {
      const shown = g.groups.filter((x) => x.length >= 3).map((x) => x.map((i) => GROUP_PHOTOS[i]).sort().join(',')).sort();
      const want = expected.groups.map((x) => [...x].sort().join(',')).sort();
      Object.assign(details, { groups: shown, groupMs: g.ms, groupFaces: g.faces });
      if (shown.join('|') !== want.join('|')) problems.push(`grouping: ${shown.length} people (${shown.join(' / ')}), expected ${want.length}`);
    }
  }
  const speed = `${r.embedMsPerFace} ms/face, ${r.detectMsPerPhoto} ms/photo detect`;
  if (problems.length) return { status: 'fail', message: `${problems.join('; ')} (${speed})`, details };
  const slow = (r.embedMsPerFace ?? 0) > SLOW_EMBED_MS;
  return { status: slow ? 'warn' : 'pass', message: `matches right${details.groups ? ', 4 people grouped right' : ''}; ${speed}${slow ? ' (slow)' : ''}`, details };
}
