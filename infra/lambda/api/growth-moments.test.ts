// Run: cd infra && npx tsx --test lambda/api/growth-moments.test.ts
// The Moments feed (docs/growth/content-engine.md): which dated events become moments, how they score,
// their Lens angle and hashtags, and that sensitive days never do.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { concertMoments, cricketMoments, finish, footballMoments, holidayMoments, parseIcs, SENSITIVE, seasonMoments, trendMoments } from './growth-moments';

const ics = (events: [string, string, string][]) =>
  ['BEGIN:VCALENDAR', ...events.flatMap(([d, s, desc]) => ['BEGIN:VEVENT', `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${s}`, `DESCRIPTION:${desc}`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test('iCal events: date, unescaped title, public holiday flag, folded lines', () => {
  const e = parseIcs(ics([['20261108', 'Diwali/Deepavali', 'Public holiday']]) + '\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261225\r\nSUMMARY:Christmas\\, Day\r\n  two\r\nDESCRIPTION:Observance\r\nEND:VEVENT');
  assert.deepEqual(e, [
    { day: '2026-11-08', title: 'Diwali/Deepavali', publicHoliday: true },
    { day: '2026-12-25', title: 'Christmas, Day two', publicHoliday: false },
  ]);
});

test('holidays: window only, merged across countries, festivals told apart from plain holidays', () => {
  const feeds = {
    IN: ics([['20261108', 'Diwali/Deepavali', 'Public holiday'], ['20270126', 'Republic Day', 'Public holiday']]),
    GB: ics([['20261108', 'Diwali/Deepavali', 'Observance'], ['20261130', "St Andrew's Day (regional holiday)", 'Observance']]),
  };
  const h = holidayMoments(feeds, '2026-11-03', '2026-12-03');
  assert.deepEqual(h.map((x) => [x.title, x.kind, x.countries.join('/')]), [
    ['Diwali/Deepavali', 'festival', 'IN/GB'],
    ["St Andrew's Day", 'holiday', 'GB'],
  ]);
});

test('seasons: on now or starting in the window, ranges across the new year', () => {
  const s = seasonMoments('2026-11-03', '2026-12-03');
  const india = s.find((x) => x.title === 'Wedding season (India)');
  assert.equal(india?.day, '2026-11-01');
  assert.equal(india?.ends, '2027-02-28');
  assert.ok(!s.some((x) => x.title === 'Graduation season'));
  assert.ok(seasonMoments('2026-12-20', '2027-01-19').some((x) => x.title === 'Year-end holidays and New Year trips' && x.day === '2026-12-18'));
});

test('scores, angles and hashtags', () => {
  const diwali = finish({ title: 'Diwali/Deepavali', kind: 'festival', day: '2026-11-08', countries: ['IN', 'GB'], source: 's', url: 'u', publicHoliday: true });
  assert.ok(diwali.score >= 90);
  assert.match(diwali.angle, /Night mode/);
  assert.deepEqual(diwali.hashtags, ['#Diwali', '#Diwali2026', '#Deepavali', '#NightPhotography']);
  const wedding = finish({ title: 'Wedding season (India)', kind: 'season', day: '2026-11-01', countries: ['IN'], source: 's', url: 'u' });
  assert.match(wedding.angle, /QR code/);
  assert.ok(!wedding.hashtags.includes('#India'));
  const plain = finish({ title: 'Black Friday', kind: 'holiday', day: '2026-11-27', countries: ['US'], source: 's', url: 'u' });
  assert.ok(plain.score < diwali.score);
  assert.doesNotMatch(plain.angle, /shared album/);
  // Devanagari keeps its vowel signs.
  assert.deepEqual(finish({ title: 'न्यूज़ीलैंड क्रिकेट टीम', kind: 'trend', day: '2026-11-03', countries: ['IN'], source: 's', url: 'u' }).hashtags, ['#न्यूज़ीलैंडक्रिकेटटीम']);
  assert.equal(diwali.id, finish({ title: 'DIWALI/Deepavali', kind: 'festival', day: '2026-11-08', countries: ['IN'], source: 's', url: 'u' }).id);
});

test('sensitive days never become moments', () => {
  for (const t of ['Election Day', 'Remembrance Sunday', 'Veterans Day', "Guru Tegh Bahadur's Martyrdom Day", 'Good Friday', 'Earthquake relief'])
    assert.ok(SENSITIVE.test(t), t);
  for (const t of ['Diwali/Deepavali', 'Thanksgiving Day', 'Christmas Day', 'Holi']) assert.ok(!SENSITIVE.test(t), t);
});

test('trends: only searches that are events', () => {
  const t = trendMoments(
    [
      { title: 'india vs new zealand', traffic: '200K+', news: [] },
      { title: 'sbi results', traffic: '50K+', news: ['Live updates: quarterly results'] },
      { title: 'new zealand cricket team', traffic: '100K+', news: ['India v New Zealand 2nd Test'] },
    ],
    'IN',
    '2026-11-03',
  );
  assert.deepEqual(t.map((x) => x.title), ['india vs new zealand', 'new zealand cricket team']);
});

test('keyed sources map to moments (cricket, football, concerts)', () => {
  const c = cricketMoments(
    { data: [
      { name: 'India vs Australia, 1st ODI', teams: ['India', 'Australia'], dateTimeGMT: '2026-11-20T08:00:00', matchEnded: false },
      { name: 'Ranji Trophy', teams: ['Delhi', 'Mumbai'], dateTimeGMT: '2026-11-20T04:00:00', matchEnded: false },
      { name: 'India vs England', teams: ['India', 'England'], dateTimeGMT: '2026-10-01T08:00:00', matchEnded: true },
    ] },
    '2026-11-03',
    '2026-12-03',
  );
  assert.deepEqual(c.map((x) => [x.title, x.day, x.time]), [['India vs Australia, 1st ODI', '2026-11-20', '2026-11-20T08:00:00Z']]);
  const f = footballMoments({ matches: [
    { utcDate: '2026-11-25T20:00:00Z', homeTeam: { name: 'Real Madrid' }, awayTeam: { name: 'Liverpool' }, competition: { code: 'CL', name: 'UEFA Champions League' }, stage: 'LEAGUE_STAGE' },
    { utcDate: '2026-11-22T15:00:00Z', homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, competition: { code: 'PL', name: 'Premier League' }, stage: 'REGULAR_SEASON' },
  ] });
  assert.deepEqual(f.map((x) => x.title), ['Real Madrid vs Liverpool (UEFA Champions League)']);
  const k = concertMoments({ _embedded: { events: [{ name: 'Coldplay', url: 'https://t/1', dates: { start: { localDate: '2026-11-30', dateTime: '2026-11-30T14:00:00Z' } } }, { name: 'No date', dates: {} }] } }, 'GB');
  assert.deepEqual(k.map((x) => [x.title, x.day, x.countries[0]]), [['Coldplay', '2026-11-30', 'GB']]);
  assert.deepEqual(cricketMoments({}, '2026-11-03', '2026-12-03'), []);
});
