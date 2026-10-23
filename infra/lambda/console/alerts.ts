// Alerts to the owners by email (hourly, EventBridge → this function with { alerts: true }):
//   health   a check in Health turned red (again every 12 h while it stays red; "all good" once fixed)
//   errors   app error spike in Sentry: a new issue with ≥ 10 events in its first hours, or the last
//            24 h at 3× the 14-day daily average (and ≥ 100 events)
//   reports  a "report" from the contact form still unanswered after 24 h (Play expects quick action;
//            the report itself is emailed when it arrives, contact.ts)
// State: STATS/ALERTS { sent: { <key>: at } }. Owners: ADMIN_EMAILS + owners added in Team.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam } from '../api/lib';
import { compute } from './health';
import { teamMembers } from './roles';

const HOUR = 3_600_000;
const ses = new SESv2Client({});
const ORG = process.env.SENTRY_ORG ?? 'instagrowapp';
const PROJECT = process.env.SENTRY_PROJECT ?? 'lens-app';
const SENTRY = process.env.SENTRY_API ?? 'https://us.sentry.io/api/0';
const CONSOLE = process.env.CONSOLE_ORIGIN ?? 'https://console.lens.instagrowapp.com';

type Alert = { key: string; subject: string; text: string; every: number };

async function healthAlerts(sent: Record<string, number>): Promise<Alert[]> {
  const h = await compute();
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'STATS', sk: 'HEALTH', data: h } }));
  const out: Alert[] = [];
  const bad = h.checks.filter((c) => c.status === 'bad');
  for (const c of bad) out.push({ key: `health:${c.name}`, subject: `Lens: ${c.name} needs attention`, text: `${c.name}: ${c.detail}\n\nHealth: ${CONSOLE}/system`, every: 12 * HOUR });
  // Recovered: everything that alerted before and isn't red now (one "fixed" email each).
  for (const k of Object.keys(sent).filter((k) => k.startsWith('health:') && !k.endsWith(':ok'))) {
    const name = k.slice(7);
    if (!bad.some((c) => c.name === name)) out.push({ key: `${k}:ok`, subject: `Lens: ${name} is fine again`, text: `${name} is back to normal.\n\n${CONSOLE}/system`, every: 0 });
  }
  return out;
}

async function errorAlerts(): Promise<Alert[]> {
  const token = await getParam('/lens/console/sentry-token');
  if (!token) return [];
  const get = async (path: string) => {
    const r = await fetch(`${SENTRY}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`sentry ${r.status}`);
    return r.json() as Promise<any>;
  };
  const out: Alert[] = [];
  const issues = (await get(`/projects/${ORG}/${PROJECT}/issues/?statsPeriod=24h&query=${encodeURIComponent('is:unresolved')}&sort=new&limit=25`)) as any[];
  for (const i of issues) {
    if (Date.now() - Date.parse(i.firstSeen) < 6 * HOUR && Number(i.count) >= 10) {
      out.push({ key: `issue:${i.id}`, subject: `Lens app: new error, ${i.count} times (${i.userCount} people)`, text: `${i.title}\n${i.culprit ?? ''}\n\n${i.permalink}\nAll errors: ${CONSOLE}/system`, every: 0 });
    }
  }
  const stats = (await get(`/projects/${ORG}/${PROJECT}/stats/?stat=received&resolution=1d&since=${Math.floor((Date.now() - 15 * 24 * HOUR) / 1000)}`)) as [number, number][];
  if (stats.length >= 3) {
    const today = stats[stats.length - 1][1]; // the current (partial) day
    const before = stats.slice(0, -1).map((x) => x[1]);
    const avg = before.reduce((a, b) => a + b, 0) / before.length;
    if (today >= 100 && today > 3 * avg) {
      out.push({ key: `spike:${new Date().toISOString().slice(0, 10)}`, subject: `Lens app: error spike (${today} today, usually ${Math.round(avg)})`, text: `App errors today: ${today}. 14-day daily average: ${Math.round(avg)}.\n\n${CONSOLE}/system`, every: 0 });
    }
  }
  return out;
}

async function reportAlerts(): Promise<Alert[]> {
  const since = Date.now() - 7 * 24 * HOUR;
  const r = await ddb.send(
    new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND sk > :s', ExpressionAttributeValues: { ':p': 'CONTACT', ':s': String(since).padStart(15, '0') } }),
  );
  return (r.Items ?? [])
    .filter((m) => m.topic === 'report' && m.status === 'new' && Date.now() - m.at > 24 * HOUR)
    .map((m) => ({ key: `report:${m.reference}`, subject: `Lens: report ${m.reference} is waiting since ${new Date(m.at).toUTCString().slice(5, 22)}`, text: `A user report hasn't been handled for over a day (Google Play expects quick action on reported content).\n\n${String(m.message).slice(0, 500)}\n\nInbox: ${CONSOLE}/support`, every: 24 * HOUR }));
}

export async function runAlerts() {
  const state = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'STATS', sk: 'ALERTS' } }))).Item;
  const sent: Record<string, number> = { ...(state?.sent ?? {}) };
  const alerts: Alert[] = [];
  for (const [name, f] of [['health', () => healthAlerts(sent)], ['errors', errorAlerts], ['reports', reportAlerts]] as const) {
    try {
      alerts.push(...(await f()));
    } catch (e) {
      console.error('alerts', name, e);
    }
  }
  const now = Date.now();
  const due = alerts.filter((a) => !sent[a.key] || (a.every > 0 && now - sent[a.key] > a.every));
  const to = (await teamMembers()).filter((m) => m.role === 'owner').map((m) => m.email);
  const sender = process.env.CODE_SENDER ?? '';
  for (const a of due) {
    if (sender.startsWith('no-reply@') && sender.length > 'no-reply@'.length && to.length) {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: `Lens Console <${sender}>`,
          Destination: { ToAddresses: to },
          Content: { Simple: { Subject: { Data: a.subject }, Body: { Text: { Data: `${a.text}\n\n— Lens Console alerts (hourly checks)` } } } },
        }),
      );
    }
    sent[a.key] = now;
    // A "fixed" email closes the matching alert: the next failure alerts again at once.
    if (a.key.endsWith(':ok')) {
      delete sent[a.key.slice(0, -3)];
      delete sent[a.key];
    }
  }
  // Forget keys older than 30 days.
  for (const k of Object.keys(sent)) if (now - sent[k] > 30 * 24 * HOUR) delete sent[k];
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'STATS', sk: 'ALERTS', sent, at: now } }));
  console.log('alerts', JSON.stringify({ checked: alerts.length, sent: due.map((a) => a.key) }));
  return { sent: due.length };
}
