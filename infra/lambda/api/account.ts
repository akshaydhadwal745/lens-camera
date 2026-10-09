// Deleting an account (Google Play requirement; privacy policy §5, delete-account page).
//
// DELETE /v1/account {confirm: "DELETE"} stops the account at once (every
// session revoked, sign-ins unlinked so the email/Google can start fresh,
// marked "deleting"), then the Maintenance function removes everything in the
// background: all media versions, previews, streaming copies, shares given and
// received, contacts, storage connections, the name and the profile. Large
// libraries take several runs; the daily maintenance resumes unfinished ones.
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { BatchWriteCommand, DeleteCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { Identity } from './identity';
import { clearedCookie, ddb, env, HttpError, json, Req, Res, withCookies } from './lib';
import { deleteAllVersions, deleteShares } from './trash';

const lambda = new LambdaClient({});
export const DELETING_GSI = 'DELETING';

const profileKey = (id: string) => ({ pk: `D#${id}`, sk: 'PROFILE' });

/** DELETE /v1/account: the user asked to delete their account and all its data. */
export async function requestAccountDeletion(identity: Identity, req: Req): Promise<Res> {
  if (req.body?.confirm !== 'DELETE') throw new HttpError(400, 'Confirm by sending {"confirm":"DELETE"}');
  const profile = (await ddb.send(new GetCommand({ TableName: env.table, Key: profileKey(identity.id) }))).Item;
  if (!profile) throw new HttpError(404, 'Account not found');

  // 1. Nothing can sign in to it any more.
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: profileKey(identity.id),
      UpdateExpression: 'SET deleting = :t, gsi1pk = :g, gsi1sk = :s',
      ExpressionAttributeValues: { ':t': Date.now(), ':g': DELETING_GSI, ':s': identity.id },
    }),
  );
  await deletePartition(identity.id, 'T#');
  await unlinkLogins(identity.id, profile);
  if (profile.fingerprint) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `FP#${profile.fingerprint}`, sk: 'DEVICE' } }));
  }

  // 2. The heavy part runs in the background.
  await startBackgroundDeletion(identity.id);
  return withCookies(json(202, { deleting: true }), [clearedCookie()]);
}

export async function startBackgroundDeletion(id: string) {
  if (!env.maintenanceFunction) return; // the daily run picks it up
  await lambda.send(
    new InvokeCommand({
      FunctionName: env.maintenanceFunction,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ deleteAccount: id })),
    }),
  );
}

/** Email/Google login records pointing at this account. */
async function unlinkLogins(id: string, profile: Record<string, any>) {
  const keys = new Set<string>(profile.loginKeys ? [...profile.loginKeys] : []);
  if (profile.email) keys.add(`ID#email#${profile.email}`);
  // Accounts from before loginKeys was recorded: find the rest (rare, one-off scan).
  if (!profile.loginKeys && (profile.logins ? [...profile.logins] : []).includes('google')) {
    let start: Record<string, any> | undefined;
    do {
      const page = await ddb.send(
        new ScanCommand({
          TableName: env.table,
          FilterExpression: 'begins_with(pk, :p) AND accountId = :a',
          ExpressionAttributeValues: { ':p': 'ID#', ':a': id },
          ProjectionExpression: 'pk',
          ExclusiveStartKey: start,
        }),
      );
      for (const item of page.Items ?? []) keys.add(item.pk as string);
      start = page.LastEvaluatedKey;
    } while (start);
  }
  for (const pk of keys) {
    // Only if it still points here (never unlink someone else's login).
    await ddb
      .send(
        new DeleteCommand({
          TableName: env.table,
          Key: { pk, sk: 'ACCOUNT' },
          ConditionExpression: 'accountId = :a',
          ExpressionAttributeValues: { ':a': id },
        }),
      )
      .catch(() => undefined);
  }
}

async function partitionItems(id: string, prefix?: string): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let start: Record<string, any> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        KeyConditionExpression: prefix ? 'pk = :p AND begins_with(sk, :s)' : 'pk = :p',
        ExpressionAttributeValues: prefix ? { ':p': `D#${id}`, ':s': prefix } : { ':p': `D#${id}` },
        ExclusiveStartKey: start,
      }),
    );
    items.push(...(page.Items ?? []));
    start = page.LastEvaluatedKey;
  } while (start);
  return items;
}

async function deleteKeys(keys: { pk: string; sk: string }[]) {
  for (let i = 0; i < keys.length; i += 25) {
    await ddb.send(
      new BatchWriteCommand({ RequestItems: { [env.table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } }),
    );
  }
}

async function deletePartition(id: string, prefix?: string) {
  const items = await partitionItems(id, prefix);
  await deleteKeys(items.filter((i) => i.sk !== 'PROFILE').map((i) => ({ pk: i.pk, sk: i.sk })));
}

/**
 * Background part. Returns true when the account is completely gone; false if
 * it ran out of time (call again).
 */
export async function continueAccountDeletion(id: string, deadline: number): Promise<boolean> {
  const profile = (await ddb.send(new GetCommand({ TableName: env.table, Key: profileKey(id) }))).Item;
  if (!profile?.deleting) return true;

  // Shares this account gave (recipients lose access), media by media.
  for (const media of await partitionItems(id, 'M#')) {
    if (Date.now() > deadline) return false;
    await deleteShares(id, media.id as string);
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: media.pk, sk: media.sk } }));
  }

  // Every stored object and old version: originals, previews, streaming copies.
  for (const prefix of [`m/${id}/`, `d/${id}/`, `h/${id}/`]) {
    if (Date.now() > deadline) return false;
    await deleteAllVersions(prefix);
  }

  // This account in other people's contact lists.
  const rest = await partitionItems(id);
  const reverseContacts = rest.filter((i) => (i.sk as string).startsWith('C#')).map((i) => ({ pk: `D#${(i.sk as string).slice(2)}`, sk: `C#${id}` }));
  await deleteKeys(reverseContacts);

  // Everything else in the account (received shares, contacts, storages…), then the name and profile.
  await deleteKeys(rest.filter((i) => i.sk !== 'PROFILE').map((i) => ({ pk: i.pk, sk: i.sk })));
  if (profile.name) await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `N#${profile.name}`, sk: 'NAME' } }));
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: profileKey(id) }));
  return true;
}

/** Daily: accounts whose deletion didn't finish (e.g. a run timed out). */
export async function pendingDeletions(): Promise<string[]> {
  const page = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :g',
      ExpressionAttributeValues: { ':g': DELETING_GSI },
      ProjectionExpression: 'gsi1sk',
    }),
  );
  return (page.Items ?? []).map((i) => i.gsi1sk as string);
}
