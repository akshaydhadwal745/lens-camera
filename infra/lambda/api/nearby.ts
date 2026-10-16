import { BatchGetCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, env, json, randomId, rateLimit, Req, Res } from './lib';

// Nearby Lens users on the same Wi-Fi (docs/design/organise-and-share.md, step 3).
// Phones announce only a short-lived random code over mDNS; this API is the only
// place a code turns into a display name, and only for people who turned
// "Visible to nearby Lens users" on (PROFILE.nearbyVisible). Real names only for
// people you already shared with (real-names.ts). Network presence
// alone proves nothing: a code is valid 15 minutes and tied to a signed-in session.
//   NB#<code> CODE { identityId, ttl }   (DynamoDB TTL removes it)

const CODE_TTL_S = 15 * 60;
const CODE = /^[A-Za-z0-9_-]{16}$/;

async function profile(id: string) {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' } }))).Item;
}

/** GET /v1/nearby → { visible }; PUT /v1/nearby {visible}. */
export async function nearbySettings(identity: Identity, req: Req): Promise<Res> {
  if (req.method === 'PUT') {
    const visible = req.body?.visible === true;
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${identity.id}`, sk: 'PROFILE' },
        UpdateExpression: 'SET nearbyVisible = :v',
        ExpressionAttributeValues: { ':v': visible },
      }),
    );
    return json(200, { visible });
  }
  return json(200, { visible: (await profile(identity.id))?.nearbyVisible === true });
}

/** POST /v1/nearby/code: a fresh code to announce (null when not visible). */
export async function nearbyCode(identity: Identity): Promise<Res> {
  await rateLimit(`nearby-code#${identity.id}`, 120);
  if ((await profile(identity.id))?.nearbyVisible !== true) return json(200, { code: null });
  const code = randomId(12).slice(0, 16);
  const ttl = Math.floor(Date.now() / 1000) + CODE_TTL_S;
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `NB#${code}`, sk: 'CODE', identityId: identity.id, ttl } }));
  return json(200, { code, expiresAt: ttl * 1000 });
}

/**
 * POST /v1/nearby/resolve {codes}: who the codes seen on this Wi-Fi belong to.
 * Only valid codes of people still visible, not me, and not blocked either way.
 */
export async function nearbyResolve(identity: Identity, req: Req): Promise<Res> {
  await rateLimit(`nearby-resolve#${identity.id}`, 600);
  const codes = Array.isArray(req.body?.codes) ? [...new Set(req.body.codes.filter((c: unknown) => typeof c === 'string' && CODE.test(c)))].slice(0, 30) : [];
  if (!codes.length) return json(200, { people: [] });
  const now = Math.floor(Date.now() / 1000);
  const found = (await ddb.send(new BatchGetCommand({ RequestItems: { [env.table]: { Keys: codes.map((c) => ({ pk: `NB#${c}`, sk: 'CODE' })) } } }))).Responses?.[env.table] ?? [];
  const ids = [...new Set(found.filter((f) => (f.ttl as number) > now && f.identityId !== identity.id).map((f) => f.identityId as string))];
  if (!ids.length) return json(200, { people: [] });
  const keys = ids.flatMap((id) => [
    { pk: `D#${id}`, sk: 'PROFILE' },
    { pk: `D#${identity.id}`, sk: `C#${id}` },
    { pk: `D#${identity.id}`, sk: `B#${id}` },
    { pk: `D#${id}`, sk: `B#${identity.id}` },
  ]);
  const rows = (await ddb.send(new BatchGetCommand({ RequestItems: { [env.table]: { Keys: keys } } }))).Responses?.[env.table] ?? [];
  const has = (pk: string, sk: string) => rows.find((r) => r.pk === pk && r.sk === sk);
  const people = ids
    .map((id) => ({ id, p: has(`D#${id}`, 'PROFILE') }))
    .filter(({ id, p }) => p?.nearbyVisible === true && !has(`D#${identity.id}`, `B#${id}`) && !has(`D#${id}`, `B#${identity.id}`))
    .map(({ id, p }) => ({ id, name: p!.name as string, realName: has(`D#${identity.id}`, `C#${id}`) ? ((p!.realName as string | undefined) ?? null) : null, account: !!p!.email, sharedBefore: !!has(`D#${identity.id}`, `C#${id}`), nearby: true }));
  return json(200, { people });
}
