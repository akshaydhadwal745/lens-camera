// The content chain (docs/growth/content-engine.md, Moments; owner 2026-11-10: "Make content" on a moment makes the
// whole set, no more buttons): every 10 minutes GrowthAnalyst takes ONE next step, so Claude, Chromium and ffmpeg
// never run two big jobs at once:
//   1. a moment task with makeAll still Ready → the agent drafts it (reel, carousel, X post);
//   2. a drafted post with make.images "todo" → its images are made (AI designer, as Make images);
//   3. a reel/short with make.reel "todo" and its images done → the reel is started (as Make reel).
// Everything stays In review; nothing is published. A step that fails is tried once more, then left for a person.
//   GROWTH / POST#<id>  make { images: todo|running|done|failed, reel: none|todo|started|failed, tries }
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env } from '../api/lib';
import { finishJob, runDraft } from './growth';
import { renderPost } from './growth-media';
import { igStats } from './growth-ig-stats';
import { duePublishes } from './growth-instagram';
import { listTasks } from './growth-tasks';

type Make = { images?: string; reel?: string; tries?: number };
type PostRow = { id: string; status: string; format: string; make?: Make; updatedAt?: number; reel?: { at?: number } };

const JOB_BUSY_MS = 20 * 60_000;
const REEL_BUSY_MS = 50 * 60_000;

async function posts(): Promise<PostRow[]> {
  const out: PostRow[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'POST#' }, ExclusiveStartKey: start }));
    out.push(...((r.Items ?? []) as PostRow[]));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

const row = async (sk: string) => (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk } }))).Item;
const busy = (r: Record<string, any> | undefined, ms: number) => !!r?.startedAt && !(r.finishedAt >= r.startedAt) && Date.now() - r.startedAt < ms;
const setMake = (id: string, make: Make) => ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${id}` }, UpdateExpression: 'SET #m = :m', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeNames: { '#m': 'make' }, ExpressionAttributeValues: { ':m': make } }));

/** The pure choice of the next step (tested). */
export function nextStep(
  tasks: { id: string; status: string; type: string; spec?: Record<string, unknown> }[],
  all: PostRow[],
  free: { analyst: boolean; render: boolean; reel: boolean },
): { kind: 'draft'; taskId: string } | { kind: 'images' | 'reel'; post: PostRow } | undefined {
  const t = tasks.find((x) => x.type === 'social' && x.status === 'ready' && x.spec?.makeAll === true);
  if (t && free.analyst) return { kind: 'draft', taskId: t.id };
  const open = all.filter((p) => p.make && p.status !== 'published' && p.status !== 'archived');
  const img = open.find((p) => p.make!.images === 'todo');
  if (img && free.render) return { kind: 'images', post: img };
  // A reel someone already made by hand (Make reel) counts: the chain never makes a second one.
  const reel = open.find((p) => p.make!.reel === 'todo' && !p.reel?.at && ['done', 'failed'].includes(p.make!.images ?? ''));
  if (reel && free.reel) return { kind: 'reel', post: reel };
  return undefined;
}

export async function contentChain(): Promise<Record<string, unknown>> {
  // Scheduled Instagram posts whose time has come go out first (growth-instagram.ts).
  const published = await duePublishes().catch((e: Error) => (console.error(JSON.stringify({ duePublishesFailed: e.message.slice(0, 200) })), []));
  if (published.length) return { chain: 'published', posts: published };
  // Results of what's already out (cheap HTTP reads; never blocks the content steps).
  await igStats().catch((e: Error) => console.error(JSON.stringify({ igStatsFailed: e.message.slice(0, 200) })));
  const [tasks, all, running, render, reel] = await Promise.all([listTasks(), posts(), row('RUNNING'), row('JOB#render'), row('JOB#reel')]);
  const free = { analyst: !(running?.at && Date.now() - running.at < JOB_BUSY_MS), render: !busy(render, JOB_BUSY_MS), reel: !busy(reel, REEL_BUSY_MS) };
  const step = nextStep(tasks, all, free);
  if (!step) return { chain: 'idle', free };
  console.log(JSON.stringify({ chainStep: step.kind, id: step.kind === 'draft' ? step.taskId : step.post.id }));
  if (step.kind === 'draft') return { chain: 'draft', result: await runDraft({ taskId: step.taskId, by: 'agent' }) };

  const p = step.post;
  const make = { ...p.make };
  if (step.kind === 'images') {
    await setMake(p.id, { ...make, images: 'running' });
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'JOB#render', startedAt: Date.now(), by: 'agent', postId: p.id } }));
    try {
      await renderPost(p.id, 'agent');
      await finishJob('render');
      await setMake(p.id, { ...make, images: 'done', tries: 0 });
      return { chain: 'images', post: p.id };
    } catch (e) {
      await finishJob('render', (e as Error).message);
      const tries = (make.tries ?? 0) + 1;
      await setMake(p.id, { ...make, images: tries < 2 ? 'todo' : 'failed', tries });
      throw e;
    }
  }
  // The reel runs in its own steps (growth-reel-job.ts); the chain only starts it.
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'JOB#reel', startedAt: Date.now(), by: 'agent', postId: p.id } }));
  const { InvokeCommand, LambdaClient } = await import('@aws-sdk/client-lambda');
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ reel: { postId: p.id }, by: 'agent' })) }));
  await setMake(p.id, { ...make, reel: 'started' });
  return { chain: 'reel', post: p.id };
}
