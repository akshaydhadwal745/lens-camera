// Contact form (website /contact/): support, privacy/grievance, account
// deletion, affiliate and business messages. No public postal address or
// mailbox for now (user decision 2026-10-09): every message is stored and
// emailed to the team with Reply-To set to the sender, so a reply goes
// straight back to them. We never email the sender automatically (a form that
// mails arbitrary addresses would be a spam cannon).
//
// Keys: CONTACT  <time>#<id>  the message (kept 2 years, privacy policy §1)
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { hashIp } from './attribution';
import { ddb, env, HttpError, json, randomId, rateLimit, Req, Res } from './lib';

const ses = new SESv2Client({});
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const CONTACT_TOPICS = ['support', 'privacy', 'grievance', 'delete-account', 'affiliate', 'business', 'other'] as const;
const KEEP_SECONDS = 2 * 365 * 86400;

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);

/** POST /v1/contact {name, email, topic, message, lang?, website?}: public. */
export async function submitContact(req: Req): Promise<Res> {
  // Honeypot: a field people never see. Bots fill it; pretend it worked.
  if (clean(req.body?.website, 200)) return json(200, { received: true, reference: randomId(4).toUpperCase() });

  const name = clean(req.body?.name, 100);
  const email = clean(req.body?.email, 254).toLowerCase();
  const topic = CONTACT_TOPICS.includes(req.body?.topic) ? (req.body.topic as string) : 'other';
  const message = clean(req.body?.message, 4000);
  if (!name) throw new HttpError(400, 'Please enter your name');
  if (!EMAIL.test(email)) throw new HttpError(400, 'Please enter a valid email address so we can reply');
  if (message.length < 10) throw new HttpError(400, 'Please write a little more about how we can help');

  // Loose per network (CGNAT puts many people behind one address), tight per email.
  if (req.sourceIp) await rateLimit(`contact#${req.sourceIp}`, 30, 'Too many messages from this network. Please try again in an hour.');
  await rateLimit(`contact#${email}`, 3, 'You’ve sent several messages already. We’ll get back to you soon.');

  const at = Date.now();
  const id = randomId(6);
  const reference = `L-${id.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}`;
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: {
        pk: 'CONTACT',
        sk: `${String(at).padStart(15, '0')}#${id}`,
        reference,
        name,
        email,
        topic,
        message,
        lang: req.body?.lang === 'hi' ? 'hi' : 'en',
        ip: hashIp(req.sourceIp),
        ua: (req.headers['user-agent'] ?? '').slice(0, 200),
        status: 'new',
        at,
        ttl: Math.floor(at / 1000) + KEEP_SECONDS,
      },
    }),
  );

  const to = env.contactTo.length ? env.contactTo : env.adminEmails;
  if (env.codeSender && to.length && !email.endsWith('@e2e.lens.invalid')) {
    await ses
      .send(
        new SendEmailCommand({
          FromEmailAddress: `Lens contact form <${env.codeSender}>`,
          Destination: { ToAddresses: to },
          ReplyToAddresses: [email],
          Content: {
            Simple: {
              Subject: { Data: `[Lens ${topic}] ${name} (${reference})` },
              Body: { Text: { Data: `From: ${name} <${email}>\nTopic: ${topic}\nReference: ${reference}\n\n${message}\n\n— Reply to this email to answer them directly.` } },
            },
          },
        }),
      )
      .catch((e) => console.error('contact email', e)); // stored anyway; visible in Admin → Inbox
  }
  return json(200, { received: true, reference });
}

/** GET /v1/admin/contact?status=new|done: the inbox. */
export async function listContact(req: Req): Promise<Res> {
  const status = req.query.status === 'done' ? 'done' : 'new';
  const rows = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p',
      FilterExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':p': 'CONTACT', ':s': status },
      ScanIndexForward: false,
      Limit: 300,
    }),
  );
  return json(200, {
    messages: (rows.Items ?? []).map((m) => ({
      id: m.sk,
      reference: m.reference,
      name: m.name,
      email: m.email,
      topic: m.topic,
      message: m.message,
      at: m.at,
      status: m.status,
    })),
  });
}

/** POST /v1/admin/contact/<id>/done: mark handled. */
export async function closeContact(adminId: string, id: string): Promise<Res> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: 'CONTACT', sk: id },
        UpdateExpression: 'SET #s = :d, doneAt = :n, doneBy = :by',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':d': 'done', ':n': Date.now(), ':by': adminId },
      }),
    );
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Message not found');
    throw error;
  }
  return json(200, { status: 'done' });
}
