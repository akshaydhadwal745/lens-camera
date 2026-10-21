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
import { activity, log } from './log';
import { overview } from './overview';
import { Permission, permissionsOf, removeTeamMember, requirePermission, ROLES, setTeamMember, teamMembers } from './roles';
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
} from './session';
import { userDetail, userSearch } from './users';

export async function handler(event: APIGatewayProxyEventV2): Promise<Res> {
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
    if (route === 'GET /sessions') return await mySessions(session);
    if (route === 'POST /sessions/end') return await endMySessions(session, req);

    if (route === 'GET /overview') return await allowed('overview', () => overview(req));

    if (route === 'GET /users') return await allowed('users', () => userSearch(req));
    if (seg[0] === 'users' && seg.length === 2 && method === 'GET') {
      need('users');
      await log({ entity: `user:${seg[1]}`, action: 'console.user.viewed', actor: `console:${email}` });
      return await userDetail(decodeURIComponent(seg[1]));
    }

    if (route === 'GET /feedback') return await allowed('feedback', () => listFeedback(req));
    if (seg[0] === 'feedback' && seg.length === 3 && seg[2] === 'done' && method === 'POST') {
      need('feedback.write');
      const id = decodeURIComponent(seg[1]);
      const res = await closeFeedback(email, id);
      await log({ entity: `feedback:${id}`, action: 'feedback.done', actor: `console:${email}` });
      return res;
    }
    if (route === 'GET /inbox') return await allowed('inbox', () => listContact(req));
    if (seg[0] === 'inbox' && seg.length === 3 && seg[2] === 'done' && method === 'POST') {
      need('inbox.write');
      const id = decodeURIComponent(seg[1]);
      const res = await closeContact(email, id);
      await log({ entity: `contact:${id}`, action: 'contact.done', actor: `console:${email}` });
      return res;
    }
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
