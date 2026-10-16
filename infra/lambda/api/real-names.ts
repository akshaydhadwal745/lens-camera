import { BatchGetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { Identity } from './identity';
import { ddb, env, HttpError, json, Req, Res } from './lib';

// Real names (2026-10-16): the Lens name (quiet-tiger-8703) stays the unique,
// permanent identity — codes, search, links and records all use it or the id.
// Each person may add the name friends know them by ("Riya Sharma") in
// Settings. It's optional, not unique (two Riya Sharmas are fine: the Lens name
// under it tells them apart), never searchable, and shown only next to the
// Lens name to people they share with, who share with them or scan their code.
// Stored as PROFILE.realName; PROFILE.googleName is only a suggestion for the
// Settings field (from Google sign-in), never shown to anyone else.

const MAX = 40;

/** Trimmed, single-spaced, no control characters, at most 40 characters; null = none. */
export function cleanRealName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? [...clean].slice(0, MAX).join('') : null;
}

/** PUT /v1/me {realName}: set (or clear with null/"") the name friends see. */
export async function setRealName(identity: Identity, req: Req): Promise<Res> {
  if (!req.body || !('realName' in req.body)) throw new HttpError(400, 'Nothing to change');
  const realName = cleanRealName(req.body.realName);
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `D#${identity.id}`, sk: 'PROFILE' },
      ...(realName
        ? { UpdateExpression: 'SET realName = :n', ExpressionAttributeValues: { ':n': realName } }
        : { UpdateExpression: 'REMOVE realName' }),
    }),
  );
  return json(200, { realName });
}

/** id → real name, for the people a response lists (missing = none set). */
export async function realNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    let request: Record<string, any> | undefined = {
      [env.table]: { Keys: unique.slice(i, i + 100).map((id) => ({ pk: `D#${id}`, sk: 'PROFILE' })), ProjectionExpression: 'pk, realName' },
    };
    while (request && Object.keys(request).length) {
      const result: any = await ddb.send(new BatchGetCommand({ RequestItems: request }));
      for (const p of result.Responses?.[env.table] ?? []) if (p.realName) out.set((p.pk as string).slice(2), p.realName as string);
      request = result.UnprocessedKeys;
    }
  }
  return out;
}
