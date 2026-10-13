import { BatchGetCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { Identity } from './identity';
import { ddb, env, json, Req, Res } from './lib';

// People share suggestions (docs/design/people.md, step 5). Face grouping runs
// only on the phone; the server never sees faces. All it keeps is one switch per
// person, PROFILE.suggestMe ("Let friends' Lens suggest me", off by default):
// a friend's phone may suggest "Share 8 photos with Riya?" only when Riya turned
// it on. The share itself still goes through the confirm sheet and Riya's accept.

/** GET /v1/people/suggest → { suggestMe }; PUT /v1/people/suggest {suggestMe}. */
export async function suggestSettings(identity: Identity, req: Req): Promise<Res> {
  if (req.method === 'PUT') {
    const suggestMe = req.body?.suggestMe === true;
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${identity.id}`, sk: 'PROFILE' },
        UpdateExpression: 'SET suggestMe = :v',
        ExpressionAttributeValues: { ':v': suggestMe },
      }),
    );
    return json(200, { suggestMe });
  }
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: 'PROFILE' } }))).Item;
  return json(200, { suggestMe: p?.suggestMe === true });
}

/**
 * For the contacts list: which of these people may be suggested to [identity].
 * True only when they turned suggestMe on and neither side blocked the other.
 */
export async function suggestFlags(identity: Identity, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 33) {
    const chunk = ids.slice(i, i + 33);
    const keys = chunk.flatMap((id) => [
      { pk: `D#${id}`, sk: 'PROFILE' },
      { pk: `D#${identity.id}`, sk: `B#${id}` },
      { pk: `D#${id}`, sk: `B#${identity.id}` },
    ]);
    let request: Record<string, any> | undefined = { [env.table]: { Keys: keys } };
    const rows: Record<string, any>[] = [];
    while (request && Object.keys(request).length) {
      const result: any = await ddb.send(new BatchGetCommand({ RequestItems: request }));
      rows.push(...(result.Responses?.[env.table] ?? []));
      request = result.UnprocessedKeys;
    }
    const has = (pk: string, sk: string) => rows.find((r) => r.pk === pk && r.sk === sk);
    for (const id of chunk) {
      if (has(`D#${id}`, 'PROFILE')?.suggestMe === true && !has(`D#${identity.id}`, `B#${id}`) && !has(`D#${id}`, `B#${identity.id}`)) out.add(id);
    }
  }
  return out;
}
