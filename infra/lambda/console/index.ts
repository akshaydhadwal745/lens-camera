// Lens Console API (console.lens.instagrowapp.com/api/*): its own Lambda, IAM role and
// sign-in, separate from the Lens app's API. Reached only through the console's CloudFront
// (edge secret); every route below sign-in needs a role permission (roles.ts).
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { auditTrail, decideAffiliate, listAffiliates, markPaid, payoutSheet, runPayouts } from '../api/affiliates';
import { closeContact, listContact } from '../api/contact';
import { closeFeedback, listFeedback } from '../api/feedback';
import { env, HttpError, json, parseEvent, Res, safeEqual } from '../api/lib';
import { adminPhones } from '../api/phones';
import { decideReferral, heldReferrals } from '../api/referrals';
import { feedbackFile } from './attachments';
import { costs } from './costs';
import { errors } from './errors';
import { health } from './health';
import { analytics } from './analytics';
import { growthDraft, growthPage, growthRun, growthTools, growthUnwatch } from './growth';
import { goalUpdate, settingsUpdate } from './growth-goals';
import { partnerSave, postSave, recordDelete } from './growth-records';
import { growthHousekeeping, migrateLegacy, workspace } from './growth-workspace';
import { taskComment, taskCreate, taskDetail, tasksPage, taskUpdate } from './growth-tasks';
import { activity, log } from './log';
import { campaigns, createNotification, estimate, lifecycleStats, stopNotification } from './notifications';
import { overview } from './overview';
import { Permission, permissionsOf, removeTeamMember, requirePermission, ROLES, roleOf, setTeamMember, teamMembers } from './roles';
import {
  activeSessions,
  currentSession,
  endMySessions,
  googleCallback,
  isEnrolled,
  logout,
  mySessions,
  ORIGIN,
  sessionInfo,
  signOutMember,
  startGoogle,
  totpSetup,
  totpVerify,
  backupCodes,
} from './session';
import { changePlan, userDetail, userSearch } from './users';
import { runAlerts } from './alerts';

export async function handler(event: APIGatewayProxyEventV2 | { alerts: true }): Promise<Res> {
  // Hourly owner alerts (EventBridge, not HTTP; console-stack.ts).
  if ('alerts' in event && event.alerts === true) {
    const alerts = await runAlerts();
    // Growth workspace: daily results loop and the Monday digest (growth-workspace.ts).
    const growth = await growthHousekeeping().catch((e) => (console.error('growth housekeeping', e), { error: String(e) }));
    return { ...(alerts as object), growth } as unknown as Res;
  }
  event = event as APIGatewayProxyEventV2;
  try {
    // Only the console's CloudFront knows the edge secret: direct calls to the function URL stop here.
    if (!env.edgeSecret || !safeEqual(event.headers?.['x-lens-edge'] ?? '', env.edgeSecret)) return json(403, { error: 'Forbidden' });
    const req = parseEvent(event);
    const method = req.method;
    const path = req.path.replace(/^\/api/, '') || '/';
    const route = `${method} ${path}`;
    const seg = path.split('/').filter(Boolean);

    // Writes: same origin only (with the SameSite=Strict cookie, this stops cross-site requests).
    if (method !== 'GET' && method !== 'HEAD') {
      if (req.headers['origin'] !== ORIGIN || req.headers['x-console'] !== '1') return json(403, { error: 'Forbidden' });
    }

    if (route === 'GET /auth/google') return await startGoogle(req);
    if (route === 'GET /auth/callback') return await googleCallback(req);

    const session = await currentSession(req);
    if (route === 'GET /session') return await sessionInfo(session);
    if (route === 'POST /auth/logout') return await logout(session);
    if (!session) throw new HttpError(401, 'Sign in again');
    if (route === 'POST /auth/totp/setup') return await totpSetup(session);
    if (route === 'POST /auth/totp') return await totpVerify(session, req);
    if (session.stage !== 'full') throw new HttpError(401, 'Enter your authenticator code');

    const { role, email } = session;
    const need = (p: Permission) => requirePermission(role, p);
    const allowed = (p: Permission, run: () => Promise<Res>) => {
      need(p);
      return run();
    };

    if (route === 'GET /me') return json(200, { email, role, permissions: permissionsOf(role) });
    if (route === 'GET /auth/backup-codes' || route === 'POST /auth/backup-codes') return await backupCodes(session, req);
    if (route === 'GET /sessions') return await mySessions(session);
    if (route === 'POST /sessions/end') return await endMySessions(session, req);

    if (route === 'GET /analytics') return await allowed('analytics', () => analytics(req));
    if (route === 'GET /growth') return await allowed('growth', () => growthPage(req));
    if (route === 'POST /growth/run') return await allowed('growth.write', () => growthRun(req, email));
    // Growth workspace tasks (growth-tasks.ts): see with growth, work with growth.contribute, manage with growth.write.
    if (route === 'GET /growth/workspace') return await allowed('growth', () => workspace(email, role));
    if (route === 'PUT /growth/settings') return await allowed('growth.write', () => settingsUpdate(req, email));
    if (seg[0] === 'growth' && seg[1] === 'goals' && seg[2] && seg.length === 3 && method === 'PUT') return await allowed('growth.write', () => goalUpdate(seg[2], req, email));
    if (seg[0] === 'growth' && (seg[1] === 'partners' || seg[1] === 'posts') && seg[2] && seg.length === 3 && method === 'PUT')
      return await allowed('growth.contribute', () => (seg[1] === 'partners' ? partnerSave(seg[2], req, email) : postSave(seg[2], req, email)));
    if (seg[0] === 'growth' && (seg[1] === 'partners' || seg[1] === 'posts') && seg[2] && seg.length === 3 && method === 'DELETE')
      return await allowed('growth.write', () => recordDelete(seg[1] === 'partners' ? 'PARTNER' : 'POST', seg[2], email));
    if (route === 'GET /growth/tasks') return await allowed('growth', async () => (await migrateLegacy(), tasksPage()));
    if (route === 'POST /growth/tasks') return await allowed('growth.contribute', () => taskCreate(req, email, role));
    if (seg[0] === 'growth' && seg[1] === 'tasks' && seg[2] && seg.length === 3 && method === 'GET') return await allowed('growth', () => taskDetail(seg[2]));
    if (seg[0] === 'growth' && seg[1] === 'tasks' && seg[2] && seg.length === 3 && method === 'PATCH') return await allowed('growth.contribute', () => taskUpdate(seg[2], req, email, role));
    if (seg[0] === 'growth' && seg[1] === 'tasks' && seg[2] && seg[3] === 'comments' && seg.length === 4 && method === 'POST') return await allowed('growth.contribute', () => taskComment(seg[2], req, email));
    if (seg[0] === 'growth' && seg[1] === 'tasks' && seg[2] && seg[3] === 'draft' && seg.length === 4 && method === 'POST') return await allowed('growth.write', () => growthDraft(seg[2], email));
    if (route === 'PUT /growth/tools') return await allowed('growth.write', () => growthTools(req, email));
    if (route === 'DELETE /growth/watch') return await allowed('growth.write', () => growthUnwatch(req, email));
    if (route === 'GET /overview') return await allowed('overview', () => overview(req));

    if (route === 'GET /users') return await allowed('users', () => userSearch(req));
    if (seg[0] === 'users' && seg.length === 2 && method === 'GET') {
      need('users');
      await log({ entity: `user:${seg[1]}`, action: 'console.user.viewed', actor: `console:${email}` });
      return await userDetail(decodeURIComponent(seg[1]));
    }

    if (seg[0] === 'users' && seg.length === 3 && seg[2] === 'plan' && method === 'POST') {
      need('users.write');
      const id = decodeURIComponent(seg[1]);
      const res = await changePlan(id, email, req);
      await log({ entity: `user:${id}`, action: `plan.${req.body?.action}`, actor: `console:${email}`, data: { planId: req.body?.planId, months: req.body?.months } });
      return res;
    }
    if (route === 'GET /feedback') return await allowed('feedback', () => listFeedback(req));
    if (seg[0] === 'feedback' && seg.length === 3 && seg[2] === 'done' && method === 'POST') {
      need('feedback.write');
      const id = decodeURIComponent(seg[1]);
      const res = await closeFeedback(email, id);
      await log({ entity: `feedback:${id}`, action: 'feedback.done', actor: `console:${email}` });
      return res;
    }
    if (seg[0] === 'feedback' && seg.length === 4 && seg[2] === 'files' && method === 'GET') {
      need('feedback');
      const id = decodeURIComponent(seg[1]);
      await log({ entity: `feedback:${id}`, action: 'feedback.screenshot.viewed', actor: `console:${email}`, data: { n: Number(seg[3]) } });
      return await feedbackFile(id, Number(seg[3]));
    }
    if (route === 'GET /inbox') return await allowed('inbox', () => listContact(req));
    if (seg[0] === 'inbox' && seg.length === 3 && seg[2] === 'done' && method === 'POST') {
      need('inbox.write');
      const id = decodeURIComponent(seg[1]);
      const res = await closeContact(email, id);
      await log({ entity: `contact:${id}`, action: 'contact.done', actor: `console:${email}` });
      return res;
    }
    if (route === 'GET /health') return await allowed('health', () => health(req));
    if (route === 'GET /errors') return await allowed('errors', () => errors(req));
    if (route === 'GET /costs') return await allowed('costs', () => costs(req));
    if (route === 'GET /phones') return await allowed('phones', () => adminPhones(req));

    if (route === 'GET /affiliates') return await allowed('affiliates', () => listAffiliates(req));
    if (seg[0] === 'affiliates' && seg.length === 2 && method === 'POST') return await allowed('affiliates', () => decideAffiliate(email, seg[1], req));
    if (route === 'GET /referrals/held') return await allowed('referrals', () => heldReferrals());
    if (seg[0] === 'referrals' && seg.length === 2 && method === 'POST') return await allowed('referrals', () => decideReferral(email, seg[1], req));
    if (route === 'GET /payouts') return await allowed('payouts', () => payoutSheet(req, email));
    if (route === 'POST /payouts/run') return await allowed('payouts', () => runPayouts(email, req));
    if (seg[0] === 'payouts' && seg.length === 4 && seg[3] === 'paid' && method === 'POST') return await allowed('payouts', () => markPaid(email, seg[1], seg[2], req));
    if (route === 'GET /audit') return await allowed('audit', () => auditTrail(req));
    if (route === 'GET /activity') return await allowed('audit', () => activity(req));

    if (route === 'GET /notifications') return await allowed('notifications', () => campaigns());
    if (route === 'GET /notifications/lifecycle') return await allowed('notifications', () => lifecycleStats(req));
    if (route === 'POST /notifications/estimate') return await allowed('notifications', () => estimate(req));
    if (route === 'POST /notifications') {
      need('notifications');
      const res = await createNotification(email, req);
      const body = JSON.parse(String(res.body));
      await log({ entity: `campaign:${body.campaign?.id}`, action: req.body?.test ? 'notifications.test-sent' : 'notifications.scheduled', actor: `console:${email}`, data: { title: body.campaign?.title, scheduledAt: body.campaign?.scheduledAt } });
      return res;
    }
    if (seg[0] === 'notifications' && seg.length === 3 && seg[2] === 'stop' && method === 'POST') {
      need('notifications');
      await log({ entity: `campaign:${seg[1]}`, action: 'notifications.stopped', actor: `console:${email}` });
      return await stopNotification(seg[1]);
    }

    if (route === 'GET /team') {
      need('team');
      const team = await teamMembers();
      const rows = await Promise.all(team.map(async (m) => ({ ...m, authenticator: await isEnrolled(m.email), sessions: await activeSessions(m.email) })));
      return json(200, { team: rows, roles: ROLES.filter((r) => r !== 'owner').map((r) => ({ role: r, permissions: permissionsOf(r) })) });
    }
    if (route === 'PUT /team') return await allowed('team', () => setTeamMember(email, req));
    if (seg[0] === 'team' && seg.length === 2 && method === 'DELETE') {
      need('team');
      const who = decodeURIComponent(seg[1]).toLowerCase();
      const res = await removeTeamMember(email, who);
      await signOutMember(session, who, true);
      return res;
    }
    if (seg[0] === 'team' && seg.length === 3 && seg[2] === 'sign-out' && method === 'POST') {
      need('team');
      const who = decodeURIComponent(seg[1]).toLowerCase();
      // Owners are signed out or reset only by the main owner (from the server configuration).
      if ((await roleOf(who)) === 'owner' && who !== email && !env.adminEmails.includes(email.toLowerCase())) throw new HttpError(403, 'Only the main owner can do this for an owner');
      await signOutMember(session, who, req.body?.resetAuthenticator === true);
      return json(200, { ok: true });
    }

    throw new HttpError(404, 'Not found');
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message, code: error.code });
    console.error(error);
    return json(500, { error: 'Something went wrong' });
  }
}
