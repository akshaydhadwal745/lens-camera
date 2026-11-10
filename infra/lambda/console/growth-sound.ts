// Reel sound (docs/growth/content-engine.md, phase 4; owner 2026-11-10: "lets move to sound"). Sound effects are
// made here in code, so they have no licence to track and land on the exact frame of the motion they belong to:
// the designer lists cues per scene (whoosh when a scene whips in, pop when the phone lands, tick on a green check,
// shutter on a photo, impact on the call to action, riser into a reveal). Music (licensed tracks from the owner's
// Pixabay picks) is mixed under them and ducked whenever an effect plays. The result is one 48 kHz stereo WAV that
// growth-video.ts muxes with the frames; ffmpeg's loudnorm then brings it to about −14 LUFS (Reels / Shorts level).
// Pure: no I/O.

export const RATE = 48_000;
export const SOUNDS = ['whoosh', 'whoosh-up', 'pop', 'tick', 'click', 'shutter', 'impact', 'riser', 'swipe', 'chime'] as const;
export type Sound = (typeof SOUNDS)[number];
export type Cue = { t: number; kind: Sound; gain?: number };

/** A seeded random source, so a reel sounds the same every time it is made. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  };
}

/** A two-pole band-pass whose centre moves over time (RBJ biquad, recomputed per sample). */
function sweepBandpass(input: Float32Array, from: number, to: number, q: number): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const f = from * Math.pow(to / from, i / input.length);
    const w = (2 * Math.PI * f) / RATE;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
    const y = b0 * input[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = input[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

const env = (i: number, n: number, attack: number, curve = 3) => {
  const a = Math.max(1, Math.floor(n * attack));
  return i < a ? i / a : Math.pow(1 - (i - a) / Math.max(1, n - a), curve);
};

/** One sound effect, mono, peak about 1. */
export function synth(kind: Sound, seed = 1): Float32Array {
  const r = rng(seed * 7919 + kind.length);
  const len = (s: number) => Math.floor(s * RATE);
  const noise = (n: number) => Float32Array.from({ length: n }, () => r());
  const norm = (a: Float32Array) => {
    let m = 0;
    for (const v of a) m = Math.max(m, Math.abs(v));
    if (m > 0) for (let i = 0; i < a.length; i++) a[i] /= m;
    return a;
  };
  switch (kind) {
    case 'whoosh':
    case 'whoosh-up': {
      const n = len(kind === 'whoosh' ? 0.42 : 0.55);
      const up = kind === 'whoosh-up';
      const f = sweepBandpass(noise(n), up ? 300 : 2600, up ? 3200 : 260, 1.1);
      for (let i = 0; i < n; i++) f[i] *= Math.sin(Math.PI * Math.pow(i / n, up ? 1.6 : 0.7));
      return norm(f);
    }
    case 'swipe': {
      const n = len(0.22);
      const f = sweepBandpass(noise(n), 4200, 1400, 2);
      for (let i = 0; i < n; i++) f[i] *= env(i, n, 0.15, 2);
      return norm(f);
    }
    case 'pop': {
      // A bubble: a sine whose pitch drops fast, with a tiny click on top.
      const n = len(0.16);
      const o = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / RATE;
        ph += (2 * Math.PI * (380 + 900 * Math.exp(-t * 55))) / RATE;
        o[i] = Math.sin(ph) * env(i, n, 0.02, 4) + (i < 90 ? r() * 0.3 * (1 - i / 90) : 0);
      }
      return norm(o);
    }
    case 'tick': {
      const n = len(0.07);
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = (Math.sin((2 * Math.PI * 2600 * i) / RATE) * 0.8 + Math.sin((2 * Math.PI * 5200 * i) / RATE) * 0.3) * Math.exp(-i / (RATE * 0.012));
      return norm(o);
    }
    case 'click': {
      const n = len(0.04);
      const f = sweepBandpass(noise(n), 3500, 2500, 3);
      for (let i = 0; i < n; i++) f[i] *= Math.exp(-i / (RATE * 0.006));
      return norm(f);
    }
    case 'shutter': {
      // Two short mechanical clacks.
      const n = len(0.16);
      const o = new Float32Array(n);
      const clack = (at: number, g: number) => {
        const s = Math.floor(at * RATE);
        const b = sweepBandpass(noise(len(0.03)), 2200, 1600, 1.5);
        for (let i = 0; i < b.length && s + i < n; i++) o[s + i] += b[i] * g * Math.exp(-i / (RATE * 0.005));
      };
      clack(0, 1);
      clack(0.075, 0.7);
      return norm(o);
    }
    case 'impact': {
      // A deep hit: a sub sine dropping in pitch under a short dark noise burst.
      const n = len(0.9);
      const o = new Float32Array(n);
      const burst = sweepBandpass(noise(len(0.12)), 900, 120, 0.7);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / RATE;
        ph += (2 * Math.PI * (48 + 70 * Math.exp(-t * 18))) / RATE;
        o[i] = Math.sin(ph) * Math.exp(-t * 4.2) + (i < burst.length ? burst[i] * 0.6 * Math.exp(-t * 30) : 0);
      }
      return norm(o);
    }
    case 'riser': {
      const n = len(1.2);
      const f = sweepBandpass(noise(n), 200, 5000, 1.4);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        ph += (2 * Math.PI * (180 + 520 * x * x)) / RATE;
        f[i] = (f[i] * 0.7 + Math.sin(ph) * 0.25) * Math.pow(x, 2.2) * (x > 0.96 ? (1 - x) / 0.04 : 1);
      }
      return norm(f);
    }
    case 'chime': {
      // A soft two-note "done" (a fifth), for a success moment.
      const n = len(0.8);
      const o = new Float32Array(n);
      for (const [f, at, g] of [[1046.5, 0, 0.7], [1568, 0.09, 0.6]] as const) {
        const s = Math.floor(at * RATE);
        for (let i = s; i < n; i++) {
          const t = (i - s) / RATE;
          o[i] += g * Math.exp(-t * 5) * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t));
        }
      }
      return norm(o);
    }
  }
}

const LEVEL: Record<Sound, number> = { whoosh: 0.5, 'whoosh-up': 0.45, swipe: 0.35, pop: 0.42, tick: 0.3, click: 0.3, shutter: 0.45, impact: 0.75, riser: 0.35, chime: 0.35 };

/** Cues from a designer (any scene) → checked: known kinds, inside the scene, not piled on top of each other. */
export function readCues(raw: unknown, seconds: number): Cue[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Cue[] = [];
  for (const c of list.slice(0, 8)) {
    const kind = String((c as Cue)?.kind ?? '') as Sound;
    const t = Number((c as Cue)?.t);
    if (!(SOUNDS as readonly string[]).includes(kind) || !Number.isFinite(t) || t < 0 || t > seconds) continue;
    if (out.some((o) => Math.abs(o.t - t) < 0.12)) continue; // two hits in the same instant sound like a mistake
    out.push({ t: Math.round(t * 100) / 100, kind });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * The reel's sound: effects at their times, music (if any) under them, ducked by 7 dB around each effect and
 * faded in and out. `music` is interleaved stereo float32 at RATE (decoded by ffmpeg). Returns stereo float32.
 */
export function mixReel(seconds: number, cues: Cue[], music?: Float32Array): Float32Array {
  const n = Math.ceil(seconds * RATE);
  const sfx = new Float32Array(n);
  const duck = new Float32Array(n).fill(1);
  cues.forEach((c, k) => {
    const s = synth(c.kind, k + 1);
    const at = Math.floor(c.t * RATE);
    const g = LEVEL[c.kind] * (c.gain ?? 1);
    for (let i = 0; i < s.length && at + i < n; i++) sfx[at + i] += s[i] * g;
    // Duck the music a little before the effect and let it come back over 0.25 s after.
    const from = Math.max(0, at - Math.floor(0.03 * RATE));
    const to = Math.min(n, at + s.length + Math.floor(0.25 * RATE));
    for (let i = from; i < to; i++) {
      const back = i > at + s.length ? (i - at - s.length) / (0.25 * RATE) : 0;
      duck[i] = Math.min(duck[i], 0.45 + 0.55 * back);
    }
  });
  const out = new Float32Array(n * 2);
  const fadeIn = 0.25 * RATE, fadeOut = 1.4 * RATE;
  for (let i = 0; i < n; i++) {
    let m = 0, mr = 0;
    if (music && music.length >= 2) {
      const j = (i * 2) % (music.length - (music.length % 2));
      const f = Math.min(1, i / fadeIn, (n - i) / fadeOut);
      m = music[j] * 0.55 * duck[i] * f;
      mr = music[j + 1] * 0.55 * duck[i] * f;
    }
    // Effects a touch wider than mono: the right channel 0.4 ms later.
    const d = Math.max(0, i - 19);
    out[i * 2] = soft(m + sfx[i]);
    out[i * 2 + 1] = soft(mr + sfx[d]);
  }
  return out;
}

/** Gentle saturation instead of hard clipping. */
const soft = (x: number) => Math.tanh(x * 1.1) / Math.tanh(1.1);

/** 16-bit PCM WAV from interleaved stereo float32. */
export function wav(stereo: Float32Array): Buffer {
  const frames = stereo.length / 2;
  const b = Buffer.alloc(44 + frames * 4);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + frames * 4, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < stereo.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, stereo[i])) * 32767), 44 + i * 2);
  return b;
}

/** Cues a template scene gets (growth-reel.ts scene types), at its local times. */
export function templateCues(type: string, seconds: number, first: boolean): Cue[] {
  const c: Cue[] = [];
  if (!first) c.push({ t: 0, kind: type === 'end' ? 'whoosh-up' : 'whoosh' });
  if (type === 'phone' || type === 'album' || type === 'fill') c.push({ t: 0.55, kind: 'pop' });
  if (type === 'qr-card') c.push({ t: 0.45, kind: 'impact', gain: 0.5 });
  if (type === 'scan') c.push({ t: 1.2, kind: 'tick' }, { t: Math.min(seconds - 0.3, 2.4), kind: 'chime' });
  if (type === 'compare') c.push({ t: 0.6, kind: 'swipe' });
  if (type === 'end') c.push({ t: Math.min(seconds - 0.6, 1.1), kind: 'impact' });
  return c.filter((x) => x.t <= seconds);
}
