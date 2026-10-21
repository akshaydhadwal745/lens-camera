// Console team and roles. Owners are ADMIN_EMAILS (CDK context `adminEmails`): fixed, can't be
// removed here. Everyone else is added by an owner in Team:
//
//   ADMIN#<email>  ROLE    → { role, addedBy, at }   (lookup)
//   ADMINS         <email> → { email, role, … }       (team list)
//
// Every route needs a permission (index.ts); the console shows only what the role allows.
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { log } from './log';
import { ddb, env, HttpError, json, Req, Res } from '../api/lib';

export const ROLES = ['owner', 'admin', 'support', 'finance', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'overview',
  'users',
  'users.write',
  'feedback',
  'feedback.write',
  'inbox',
  'inbox.write',
  'phones',
  'health',
  'costs',
  'referrals',
  'affiliates',
  'payouts',
  'audit',
  'team',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'team'),
  support: ['overview', 'users', 'users.write', 'feedback', 'feedback.write', 'inbox', 'inbox.write', 'phones', 'health'],
  finance: ['overview', 'referrals', 'affiliates', 'payouts', 'costs', 'audit'],
  viewer: ['overview', 'phones', 'health'],
};

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const ADDABLE: Role[] = ['admin', 'support', 'finance', 'viewer'];

export const permissionsOf = (role: Role) => GRANTS[role];
export const can = (role: Role, p: Permission) => GRANTS[role].includes(p);

/** 404 (not 403): routes the role can't use don't reveal themselves. */
export function requirePermission(role: Role, p: Permission) {
  if (!can(role, p)) throw new HttpError(404, 'Not found');
}

/** The console role of this Google email, or null (not on the team). */
export async function roleOf(email: string): Promise<Role | null> {
  const e = email.toLowerCase();
  if (env.adminEmails.includes(e)) return 'owner';
  const r = await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `ADMIN#${e}`, sk: 'ROLE' } }));
  const role = r.Item?.role as Role | undefined;
  return role && ROLES.includes(role) && role !== 'owner' ? role : null;
}

export async function teamMembers() {
  const owners = env.adminEmails.map((email) => ({ email, role: 'owner' as Role, fixed: true, addedBy: undefined as string | undefined, at: undefined as number | undefined }));
  const members: typeof owners = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'ADMINS' }, ExclusiveStartKey: start }),
    );
    for (const i of r.Items ?? []) if (!env.adminEmails.includes(i.email)) members.push({ email: i.email, role: i.role, fixed: false, addedBy: i.addedBy, at: i.at });
    start = r.LastEvaluatedKey;
  } while (start);
  return [...owners, ...members];
}

/** PUT /api/team {email, role}: add someone or change their role. */
export async function setTeamMember(by: string, req: Req): Promise<Res> {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const role = req.body?.role as Role;
  if (!EMAIL.test(email)) throw new HttpError(400, 'Enter the person’s Google email address');
  if (!ADDABLE.includes(role)) throw new HttpError(400, 'Choose a role: admin, support, finance or viewer');
  if (env.adminEmails.includes(email)) throw new HttpError(400, 'That person is an owner already');
  const at = Date.now();
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `ADMIN#${email}`, sk: 'ROLE', role, addedBy: by, at } }));
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'ADMINS', sk: email, email, role, addedBy: by, at } }));
  await log({ entity: `console:${email}`, action: 'team.role-set', actor: `console:${by}`, data: { role } });
  return json(200, { email, role });
}

/** DELETE /api/team/<email>: removes access at once (their sessions end on the next request). */
export async function removeTeamMember(by: string, rawEmail: string): Promise<Res> {
  const email = rawEmail.trim().toLowerCase();
  if (env.adminEmails.includes(email)) throw new HttpError(400, 'Owners can’t be removed here');
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `ADMIN#${email}`, sk: 'ROLE' } }));
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'ADMINS', sk: email } }));
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `CADMIN#${email}`, sk: 'TOTP' } }));
  await log({ entity: `console:${email}`, action: 'team.removed', actor: `console:${by}` });
  return json(200, { removed: email });
}
