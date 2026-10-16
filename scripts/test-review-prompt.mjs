// Unit test for src/lib/review-prompt-rules.ts: node scripts/test-review-prompt.mjs
// Node 24 runs the TypeScript file directly (type stripping): the rules file has no imports.
const { decidePrompt } = await import('../src/lib/review-prompt-rules.ts');
const DAY = 86_400_000, now = Date.UTC(2026, 9, 16);
const user = { opens: 6, firstOpenAt: now - 5 * DAY, asks: [] };
const happy = { photos: 40, calm: true };
let fails = 0;
const t = (name, got, want) => { const ok = got === want; if (!ok) fails++; console.log(`${ok ? '✔' : '✘'} ${name}: ${got}`); };
t('engaged user, calm → rate', decidePrompt(user, now, happy), 'rate');
t('new user (2 opens) → nothing', decidePrompt({ ...user, opens: 2 }, now, happy), null);
t('only 1 day old → nothing', decidePrompt({ ...user, firstOpenAt: now - DAY }, now, happy), null);
t('uploads pending → nothing', decidePrompt(user, now, { photos: 40, calm: false }), null);
t('few photos → nothing', decidePrompt(user, now, { photos: 3, calm: true }), null);
t('asked 10 days ago → nothing', decidePrompt({ ...user, asks: [now - 10 * DAY] }, now, happy), null);
t('asked 40 days ago, no answer → rate again', decidePrompt({ ...user, asks: [now - 40 * DAY] }, now, happy), 'rate');
t('3 asks this year → nothing', decidePrompt({ ...user, asks: [now - 300 * DAY, now - 200 * DAY, now - 100 * DAY] }, now, happy), null);
t('rated 50 days ago → quiet', decidePrompt({ ...user, ratedAt: now - 50 * DAY, asks: [now - 50 * DAY] }, now, happy), null);
t('rated 130 days ago → missing', decidePrompt({ ...user, ratedAt: now - 130 * DAY, asks: [now - 130 * DAY] }, now, happy), 'missing');
t('never → nothing', decidePrompt({ ...user, never: true }, now, happy), null);
process.exit(fails ? 1 : 0);
