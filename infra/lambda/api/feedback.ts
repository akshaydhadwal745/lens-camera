// In-app feedback (Settings → Send feedback): a rating + review, an issue report,
// a feature idea or anything else. Every submission is stored first, then the
// team is emailed (Reply-To = the user's optional contact email). If the email
// fails, the row stays `email: 'pending'` and Maintenance retries it every hour,
// so nothing is lost. Device details are kept only when the user leaves
// "Include phone model and app version" on.
//
// Keys: FEEDBACK  <time>#<id>  the submission (kept 2 years, privacy policy §1)
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { hashIp } from './attribution';
import { Identity } from './identity';
import { ddb, env, HttpError, json, randomId, rateLimit, Req, Res } from './lib';

const ses = new SESv2Client({});
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const FEEDBACK_KINDS = ['review', 'issue', 'idea', 'other', 'report'] as const;
type Kind = (typeof FEEDBACK_KINDS)[number];
// report: someone reported content or a person from the app (Play UGC policy; src/lib/report.ts).
const KIND_LABEL: Record<Kind, string> = { review: 'Review', issue: 'Issue', idea: 'Feature idea', other: 'Feedback', report: 'REPORT (content or user)' };
const KEEP_SECONDS = 2 * 365 * 86400;
/** Email retries stop after this many tries (the row stays in Admin → Feedback). */
const MAX_EMAIL_TRIES = 8;

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);

/** Only these device fields are kept, each a short string. */
function deviceDetails(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const k of ['brand', 'model', 'os', 'osVersion', 'appVersion', 'build', 'code', 'locale']) {
    const v = clean((raw as Record<string, unknown>)[k], 80);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** POST /v1/feedback {kind, rating?, message, email?, includeDevice, device?, website?}: signed-in or guest app users. */
export async function submitFeedback(identity: Identity, req: Req): Promise<Res> {
  // Honeypot (never shown): bots that fill it get a fake success.
  if (clean(req.body?.website, 200)) return json(200, { received: true, reference: `F-${randomId(4).toUpperCase()}` });

  const kind: Kind = FEEDBACK_KINDS.includes(req.body?.kind) ? req.body.kind : 'other';
  // Where it came from: Settings, or the roll's feedback card (rating / "what's missing?").
  const source = ['settings', 'prompt', 'prompt-missing', 'report'].includes(req.body?.source) ? (req.body.source as string) : 'settings';
  const ratingRaw = req.body?.rating;
  const rating = ratingRaw === undefined || ratingRaw === null ? undefined : Number(ratingRaw);
  if (rating !== undefined && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new HttpError(400, 'Rating must be 1 to 5 stars');
  if (kind === 'review' && rating === undefined) throw new HttpError(400, 'Tap a star to rate Lens');
  const message = clean(req.body?.message, 4000);
  if (kind !== 'review' && message.length < 10) throw new HttpError(400, 'Please write a little more so we can understand');
  const email = clean(req.body?.email, 254).toLowerCase();
  if (email && !EMAIL.test(email)) throw new HttpError(400, 'That email address doesn’t look right');
  const device = req.body?.includeDevice === true ? deviceDetails(req.body?.device) : undefined;

  await rateLimit(`feedback#${identity.id}`, 10, 'You’ve sent a lot of feedback this hour. Thank you! Please try again later.');
  if (req.sourceIp) await rateLimit(`feedback-ip#${req.sourceIp}`, 40, 'Too many messages from this network. Please try again in an hour.');

  const at = Date.now();
  const id = randomId(6);
  const reference = `F-${id.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}`;
  const item = {
    pk: 'FEEDBACK',
    sk: `${String(at).padStart(15, '0')}#${id}`,
    reference,
    kind,
    source,
    ...(rating !== undefined ? { rating } : {}),
    message,
    ...(email ? { email } : {}),
    accountEmail: identity.email ?? undefined,
    identityId: identity.id,
    ...(device ? { device } : {}),
    ip: hashIp(req.sourceIp),
    status: 'new',
    email_status: 'pending',
    emailTries: 0,
    at,
    ttl: Math.floor(at / 1000) + KEEP_SECONDS,
  };
  await ddb.send(new PutCommand({ TableName: env.table, Item: item }));
  // After it's stored: an email failure never loses the feedback (Maintenance retries).
  await emailFeedback(item).catch((e) => console.error('feedback email', e));
  return json(200, { received: true, reference });
}

const stars = (n?: number) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

/** Sends one stored submission to the team and marks it sent. Throws if SES fails. */
async function emailFeedback(f: Record<string, any>): Promise<void> {
  const to = env.contactTo.length ? env.contactTo : env.adminEmails;
  const test = String(f.email ?? f.accountEmail ?? '').endsWith('@e2e.lens.invalid') || String(f.message).startsWith('[e2e]');
  if (!env.codeSender || !to.length || test) {
    await markEmail(f.sk, test ? 'skipped' : 'pending', !test);
    return;
  }
  const replyTo = f.email || f.accountEmail;
  const device = f.device ? Object.entries(f.device).map(([k, v]) => `${k}: ${v}`).join(', ') : 'not shared';
  const label = KIND_LABEL[f.kind as Kind] ?? 'Feedback';
  const body = [
    `${label}${f.rating ? ` ${stars(f.rating)} (${f.rating}/5)` : ''}`,
    `Reference: ${f.reference} · from ${f.source === 'prompt' ? 'the in-app rating card' : f.source === 'prompt-missing' ? 'the “what’s missing?” card' : f.source === 'report' ? 'an in-app Report button' : 'Settings → Feedback'}`,
    `From: ${f.email ? `${f.email} (wants a reply)` : f.accountEmail ? `${f.accountEmail} (account email, no reply asked)` : 'guest, no email'}`,
    `Device: ${device}`,
    '',
    f.message || '(no text)',
    '',
    replyTo ? '— Reply to this email to answer them directly.' : '— No reply address. Also in Admin → Feedback.',
  ].join('\n');
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: `Lens feedback <${env.codeSender}>`,
        Destination: { ToAddresses: to },
        ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
        Content: {
          Simple: {
            Subject: { Data: `[Lens ${label}]${f.rating ? ` ${stars(f.rating)}` : ''} ${String(f.message || '').slice(0, 60)} (${f.reference})` },
            Body: { Text: { Data: body } },
          },
        },
      }),
    );
  } catch (e) {
    await markEmail(f.sk, 'pending', true);
    throw e;
  }
  await markEmail(f.sk, 'sent', true);
}

async function markEmail(sk: string, status: 'sent' | 'pending' | 'skipped', tried: boolean) {
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: 'FEEDBACK', sk },
      UpdateExpression: tried ? 'SET email_status = :s, emailTries = if_not_exists(emailTries, :z) + :one, emailAt = :n' : 'SET email_status = :s',
      ExpressionAttributeValues: tried ? { ':s': status, ':z': 0, ':one': 1, ':n': Date.now() } : { ':s': status },
    }),
  );
}

/** Maintenance (hourly): emails that failed or weren't sent yet, newest week only. */
export async function retryFeedbackEmails(): Promise<{ retried: number; sent: number }> {
  const since = String(Date.now() - 7 * 86400_000).padStart(15, '0');
  const rows = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND sk > :since',
      FilterExpression: 'email_status = :pending AND (attribute_not_exists(emailTries) OR emailTries < :max)',
      ExpressionAttributeValues: { ':p': 'FEEDBACK', ':since': since, ':pending': 'pending', ':max': MAX_EMAIL_TRIES },
    }),
  );
  let sent = 0;
  for (const f of rows.Items ?? []) {
    try {
      await emailFeedback(f);
      sent++;
    } catch (e) {
      console.error('feedback email retry', f.reference, e);
    }
  }
  return { retried: rows.Items?.length ?? 0, sent };
}

/** GET /v1/admin/feedback?status=new|done&kind=: newest first. */
export async function listFeedback(req: Req): Promise<Res> {
  const status = req.query.status === 'done' ? 'done' : 'new';
  const kind = FEEDBACK_KINDS.includes(req.query.kind as Kind) ? req.query.kind : undefined;
  const rows = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p',
      FilterExpression: kind ? '#s = :s AND kind = :k' : '#s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':p': 'FEEDBACK', ':s': status, ...(kind ? { ':k': kind } : {}) },
      ScanIndexForward: false,
      Limit: 300,
    }),
  );
  return json(200, {
    feedback: (rows.Items ?? []).map((f) => ({
      id: f.sk,
      reference: f.reference,
      kind: f.kind,
      source: f.source,
      rating: f.rating,
      message: f.message,
      email: f.email,
      accountEmail: f.accountEmail,
      device: f.device,
      at: f.at,
      status: f.status,
      emailStatus: f.email_status,
    })),
  });
}

/** POST /v1/admin/feedback/<id>/done: mark handled. */
export async function closeFeedback(adminId: string, id: string): Promise<Res> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: 'FEEDBACK', sk: id },
        UpdateExpression: 'SET #s = :d, doneAt = :n, doneBy = :by',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':d': 'done', ':n': Date.now(), ':by': adminId },
      }),
    );
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Feedback not found');
    throw error;
  }
  return json(200, { status: 'done' });
}
