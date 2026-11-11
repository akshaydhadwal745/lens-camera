// Reel voiceover (docs/growth/content-engine.md; owner 2026-11-11: "a real editor would add voice over", "catchy,
// not just repeating the AI lines but a real human kind of transcript"). The writer gives each scene a spoken line
// (`vo`); Amazon Polly's generative voice Ruth (US English) says it: one Lens voice for every reel (owner
// 2026-11-11: "we chose Ruth"). Each scene is stretched to fit its line before it is designed, so the voice never runs
// over a cut, and the music ducks under the voice in growth-sound.ts. Polly runs in us-east-1 (generative voices
// aren't in ap-south-1), keyless through the Lambda role. About 300 characters a reel: well under ₹1.
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

/** The Lens voice, on every reel. */
export const VOICE = 'Ruth';

/** The longest a scene may get to fit its line, and the reel's limit with a voice (a little more room to speak). */
export const SCENE_MAX = 7;
export const VOICE_MAX_SECONDS = 34;
/** Quiet before a line starts in its scene, and after it ends before the cut. */
export const LEAD = 0.25;
export const TAIL = 0.35;

let polly: PollyClient | undefined;

/** One line spoken by a Polly generative voice → MP3 (24 kHz). */
export async function speak(text: string, voice: string = VOICE): Promise<Buffer> {
  polly ??= new PollyClient({ region: 'us-east-1' });
  const r = await polly.send(new SynthesizeSpeechCommand({ Engine: 'generative', VoiceId: voice as never, OutputFormat: 'mp3', SampleRate: '24000', TextType: 'text', Text: text.slice(0, 400) }));
  return Buffer.from(await r.AudioStream!.transformToByteArray());
}

/**
 * Scene lengths that fit the spoken lines: each scene with a line lasts at least LEAD + line + TAIL (up to
 * SCENE_MAX); if the whole reel is then over VOICE_MAX_SECONDS, scenes without a line give their time back first,
 * then every scene's spare time shrinks evenly. A line never gets cut. Pure (tested).
 */
export function fitToVoice(scenes: { n: number; seconds: number }[], spoken: Map<number, number>): number[] {
  const need = scenes.map((s) => (spoken.has(s.n) ? Math.min(SCENE_MAX, LEAD + spoken.get(s.n)! + TAIL) : 2));
  const out = scenes.map((s, i) => Math.max(s.seconds, need[i]));
  const over = () => out.reduce((a, b) => a + b, 0) - VOICE_MAX_SECONDS;
  for (let i = 0; i < out.length && over() > 0; i++) if (!spoken.has(scenes[i].n)) out[i] = Math.max(need[i], out[i] - over());
  if (over() > 0) {
    const spare = out.map((v, i) => v - need[i]);
    const total = spare.reduce((a, b) => a + b, 0);
    const cut = Math.min(over(), total);
    if (total > 0) for (let i = 0; i < out.length; i++) out[i] -= (spare[i] / total) * cut;
  }
  // Round down to 0.1 s (so the total stays under the limit), never below what the line needs.
  return out.map((v, i) => Math.max(Math.ceil(need[i] * 10) / 10, Math.floor(v * 10 + 1e-6) / 10));
}

/** Ad-speak a real person never says out loud. */
const AD_SPEAK = /\b(are you tired of|say goodbye to|look no further|introducing|meet lens|we've got you covered|game[- ]?changer|next level|revolutionary|seamless(ly)?|effortless(ly)?|unlock|elevate|don't miss out|act now|what if i told you)\b/i;

/** What's wrong with a scene's spoken line (empty = fine). `screen` = the scene's on-screen words. */
export function voiceLineProblems(vo: string, screen: string): string[] {
  const out: string[] = [];
  const words = vo.split(/\s+/).filter(Boolean);
  if (words.length > 18) out.push(`${words.length} words (18 at most, it has to fit the scene)`);
  const ad = AD_SPEAK.exec(vo);
  if (ad) out.push(`ad-speak: "${ad[0]}" (say it like a friend would)`);
  // The voice adds to the screen; reading the screen out loud wastes the line.
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);
  const shown = new Set(norm(screen));
  const said = norm(vo);
  if (said.length >= 4 && shown.size >= 3 && said.filter((w) => shown.has(w)).length / said.length > 0.6) out.push('it mostly repeats the on-screen words (say the human part around them instead)');
  return out;
}
