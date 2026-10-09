// Smooth streaming of long videos: HLS (540p + 1080p, 4 s fMP4 segments) made
// lazily on AWS Batch (Fargate Spot) the first time someone plays the video on
// a device that doesn't have it. Short clips just play the original.
//
// Links: /t/{exp}-{sig}/h/{keyOwner}/{id}/master.m3u8. The signature covers the
// video's folder, so segment URLs (relative) inherit it; a CloudFront Function
// checks and strips it (see lens-stack.ts).
import { createHmac } from 'node:crypto';

import { BatchClient, DescribeJobsCommand, SubmitJobCommand } from '@aws-sdk/client-batch';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, env, getParam, HttpError, json, Req, Res } from './lib';
import { getMedia, mediaKey, MediaRecord } from './media';

const batchClient = new BatchClient({});

/** Below both: play the original (no transcode). */
const MIN_STREAM_BYTES = 100 * 1024 * 1024;
const MIN_STREAM_SECONDS = 60;
const LINK_SECONDS = 6 * 3600;
/** A queued job older than this is considered lost and re-submitted. */
const STALE_QUEUED_MS = 3 * 3600 * 1000;

const MEDIA_ID = /^[0-9a-z]{8}-[0-9a-z]{4,12}$/;

/** h/{owner}/{id}/ from the original's key m/{owner}/{id}.{ext} (keys survive account merges). */
export function streamPrefix(key: string): string {
  const [, owner, file] = key.split('/');
  return `h/${owner}/${file.slice(0, file.lastIndexOf('.'))}/`;
}

async function streamUrl(key: string): Promise<string> {
  const secret = await getParam(env.streamKeyParam);
  if (!secret) throw new HttpError(503, 'Streaming isn’t available yet');
  const exp = Math.floor(Date.now() / 1000) + LINK_SECONDS;
  const folder = `/${streamPrefix(key)}`;
  const sig = createHmac('sha256', secret).update(`${exp}:${folder}`).digest('hex').slice(0, 32);
  return `https://${env.cdnDomain}/t/${exp}-${sig}${folder}master.m3u8`;
}

/** The video, if this identity owns it or it was shared with them (and not deleted). */
async function resolveVideo(identity: Identity, mediaId: string, ownerId?: string): Promise<{ item: MediaRecord; ownerId: string }> {
  if (!MEDIA_ID.test(mediaId)) throw new HttpError(400, 'Invalid media id');
  const owner = ownerId ?? identity.id;
  if (owner !== identity.id) {
    const share = await ddb.send(
      new GetCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `S#${mediaId}#${owner}` } }),
    );
    if (!share.Item) throw new HttpError(404, 'Not found');
  }
  const item = await getMedia(owner, mediaId);
  if (!item || item.deletedAt) throw new HttpError(404, 'Not found');
  return { item, ownerId: owner };
}

async function submit(item: MediaRecord, ownerId: string, onDemand: boolean) {
  const job = await batchClient.send(
    new SubmitJobCommand({
      jobName: `hls-${item.id}`,
      jobQueue: onDemand ? env.transcodeQueueOnDemand : env.transcodeQueueSpot,
      jobDefinition: env.transcodeJob,
      containerOverrides: {
        environment: [
          { name: 'KEY', value: item.key },
          { name: 'OUT', value: streamPrefix(item.key) },
          { name: 'OWNER', value: ownerId },
          { name: 'MEDIA_ID', value: item.id },
        ],
      },
    }),
  );
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: mediaKey(ownerId, item.id),
      UpdateExpression: 'SET streamStatus = :q, streamJobId = :j, streamQueuedAt = :t ADD streamAttempts :one',
      ExpressionAttributeValues: { ':q': 'queued', ':j': job.jobId, ':t': Date.now(), ':one': 1 },
    }),
  );
}

/** True if the job is still on its way (not failed, not lost). */
async function jobAlive(item: MediaRecord): Promise<boolean> {
  if (!item.streamJobId || Date.now() - (item.streamQueuedAt ?? 0) > STALE_QUEUED_MS) return false;
  const result = await batchClient.send(new DescribeJobsCommand({ jobs: [item.streamJobId] }));
  const status = result.jobs?.[0]?.status;
  return !!status && status !== 'FAILED' && status !== 'SUCCEEDED';
}

/**
 * POST /v1/stream {mediaId, ownerId?}: how to play a video on this device.
 *   ready     → { url } HLS master playlist (adaptive 540p/1080p)
 *   preparing → play the original meanwhile; conversion has started
 *   original  → short/small video: just play the original
 */
export async function requestStream(identity: Identity, req: Req): Promise<Res> {
  const mediaId = String(req.body.mediaId ?? '');
  const ownerId = typeof req.body.ownerId === 'string' ? req.body.ownerId : undefined;
  const { item, ownerId: owner } = await resolveVideo(identity, mediaId, ownerId);

  if (item.kind !== 'video' || item.status !== 'ready' || item.location) return json(200, { status: 'original' });
  if (item.size < MIN_STREAM_BYTES && (item.duration ?? 0) < MIN_STREAM_SECONDS) return json(200, { status: 'original' });

  if (item.streamStatus === 'ready') return json(200, { status: 'ready', url: await streamUrl(item.key) });

  if (item.streamStatus === 'queued' && (await jobAlive(item))) return json(200, { status: 'preparing' });

  // Never started, failed (e.g. Spot interrupted every retry) or lost: (re)submit.
  // After a failed Spot run, use on-demand capacity (never interrupted).
  await submit(item, owner, (item.streamAttempts ?? 0) >= 1);
  return json(202, { status: 'preparing' });
}
