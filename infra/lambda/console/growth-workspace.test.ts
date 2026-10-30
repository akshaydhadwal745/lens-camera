// Run: cd infra && npx tsx --test lambda/console/growth-workspace.test.ts
// The growth workspace's rules: task priority and lifecycle, mentions, goal/KR/milestone progress,
// AI output → tasks, and partner/post fields.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { goalStatus, krProgress, milestoneProgress, period } from './growth-goals';
import { codeOf, partnerFields, partnerLink, postFields } from './growth-records';
import { cleanFields, mentionedEmails, priorityOf, transitionProblem, type Task } from './growth-tasks';
import { oppTask, propTask, recTask } from './growth-workspace';

const base = { id: 'T-1', title: 't', status: 'ready', links: { page: '', keyword: '', campaign: '', partner: '', post: '' }, wontDoReason: '', blockedBy: '', reviewer: '', proof: '' } as unknown as Task;

test('priority from impact × confidence ÷ effort', () => {
  assert.equal(priorityOf(3, 3, 2), 0); // high, sure, quick → do now
  assert.equal(priorityOf(3, 2, 8), 1);
  assert.equal(priorityOf(2, 2, 24), 2);
  assert.equal(priorityOf(1, 1, 40), 3);
});

test('task fields: only known fields, capped, typed; unknown keys and bad values dropped', () => {
  const f = cleanFields({ title: 'x'.repeat(500), workstream: 'nope', owner: 'not-an-email', due: '31/10/2026', impact: 9, pk: 'CSESS#x', evil: 1 });
  assert.equal(f.title!.length, 160);
  assert.equal(f.workstream, 'search');
  assert.equal(f.owner, '');
  assert.equal(f.due, '');
  assert.equal(f.impact, 3);
  assert.equal('pk' in f, false);
  assert.equal('evil' in f, false);
  assert.equal(cleanFields({ owner: 'Agent' }).owner, '');
  assert.equal(cleanFields({ owner: 'agent' }).owner, 'agent');
});

test('lifecycle rules: what each status needs, and who may accept suggestions', () => {
  assert.match(transitionProblem({ ...base, status: 'suggested' }, 'ready', {}, false)!, /growth lead/);
  assert.equal(transitionProblem({ ...base, status: 'suggested' }, 'ready', {}, true), undefined);
  assert.match(transitionProblem(base, 'wontdo', {}, true)!, /why not/);
  assert.equal(transitionProblem(base, 'wontdo', { wontDoReason: 'not our audience' }, true), undefined);
  assert.match(transitionProblem(base, 'blocked', {}, true)!, /blocks/);
  assert.match(transitionProblem(base, 'in_review', {}, true)!, /reviewer/);
  assert.match(transitionProblem(base, 'done', {}, true)!, /proof/);
  assert.equal(transitionProblem({ ...base, links: { ...base.links, pr: { url: 'u', number: 1 } } }, 'done', {}, true), undefined);
  assert.match(transitionProblem(base, 'measured', {}, true)!, /result/);
  assert.match(transitionProblem(base, 'nope' as never, {}, true)!, /Unknown/);
});

test('@mentions match a team member by the start of the email or the full email', () => {
  const team = ['priya@instagrowapp.com', 'akshaydhadwal2@gmail.com'];
  assert.deepEqual(mentionedEmails('@priya can you check? cc @akshaydhadwal2@gmail.com', team), team);
  assert.deepEqual(mentionedEmails('no mentions, email me at priya@instagrowapp.com', team), []);
});

test('key result progress moves from baseline to target, either direction, clamped', () => {
  assert.equal(krProgress({ baseline: 0, target: 12 }, 9), 0.75);
  assert.equal(krProgress({ baseline: 10, target: 0 }, 2.5), 0.75); // lower is better
  assert.equal(krProgress({ baseline: 0, target: 10 }, 15), 1);
  assert.equal(krProgress({ baseline: 0, target: 10 }, -3), 0);
  assert.equal(krProgress({ baseline: 0, target: 10 }, null), null);
});

test('goal period: fixed dates, or days after launch (unknown until the launch date is set)', () => {
  assert.deepEqual(period({ start: '2026-10-30', end: '2026-11-29' }, ''), { start: '2026-10-30', end: '2026-11-29' });
  assert.equal(period({ afterLaunchDays: 30 }, ''), null);
  assert.deepEqual(period({ afterLaunchDays: 30 }, '2026-11-20'), { start: '2026-11-20', end: '2026-12-20' });
});

test('goal status: progress against the share of the period elapsed', () => {
  const p = { start: '2026-11-01', end: '2026-11-30' };
  const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
  assert.equal(goalStatus([0.5], p, at('2026-11-15')).status, 'on_track');
  assert.equal(goalStatus([0.3], p, at('2026-11-15')).status, 'at_risk');
  assert.equal(goalStatus([0.1], p, at('2026-11-15')).status, 'behind');
  assert.equal(goalStatus([1, 1], p, at('2026-11-15')).status, 'done');
  assert.equal(goalStatus([0.2], p, at('2026-10-20')).status, 'not_started');
  assert.equal(goalStatus([0.2], null, at('2026-11-15')).status, 'not_started');
  assert.equal(goalStatus([1], null, at('2026-11-15'), 'health').status, 'on_track');
});

test('milestone progress: done tasks weighted by effort; won’t-do excluded', () => {
  const m = milestoneProgress([
    { status: 'done', effortHours: 6 },
    { status: 'measured', effortHours: 2 },
    { status: 'in_progress', effortHours: 8 },
    { status: 'wontdo', effortHours: 50 },
  ]);
  assert.deepEqual(m, { done: 2, total: 3, share: 0.5 });
  assert.deepEqual(milestoneProgress([]), { done: 0, total: 0, share: null });
});

test('AI output → tasks: opportunities, recommendations and proposals land in the right workstream', () => {
  const opp = { topic: 'Free cloud storage', targetKeyword: 'free cloud storage', action: 'improve-page', demand: 'high', winnability: 'low', relevanceReason: 'r', demandEvidence: 'Bing 4,769', competition: 'big brands', existingPage: '/features/free-cloud-backup/', businessValue: 'v', measurement: 'm', facts: ['demand.bing.us.free_cloud_storage'], brief: { url: '/x/', title: 'T' } };
  const o = oppTask(opp, 6.8);
  assert.equal(o.title, 'Improve /features/free-cloud-backup/ for “free cloud storage”');
  assert.equal(o.workstream, 'search');
  assert.equal(o.type, 'content');
  assert.equal(o.impact, 3);
  assert.equal(o.confidence, 1);
  assert.equal(oppTask({ ...opp, action: 'social-post' }, 1).workstream, 'social');
  const r = recTask({ title: 'Run a QR event', workstream: 'loops', hypothesis: 'h', expectedImpact: 'e', effort: 'medium', cost: 'c', timeToResult: 't', risk: 'r', metric: 'guests', stopRule: 's', facts: ['loops.event_join'] });
  assert.equal(r.workstream, 'loops');
  assert.equal(r.effortHours, 8);
  assert.equal(r.metric!.label, 'guests');
  assert.equal(propTask({ title: 'p', evidence: 'e', files: ['site/src/content/pages.ts:37'], change: 'c', measurement: 'm' }).type, 'fix');
});

test('partners and posts: known fields only, a tagged link per partner', () => {
  const f = partnerFields({ name: 'Studio Rangoli', type: 'photographer', stage: 'nope', pk: 'x' });
  assert.equal(f.stage, 'lead');
  assert.equal('pk' in f, false);
  const code = codeOf('Studio Rangoli');
  assert.match(code, /^studio-rangoli-[a-f0-9]{4}$/);
  assert.equal(partnerLink(code), `https://lens.instagrowapp.com/?utm_source=partner&utm_medium=referral&utm_campaign=${code}`);
  assert.equal(postFields({ channel: 'tiktok', status: 'published' }).channel, 'other');
});
