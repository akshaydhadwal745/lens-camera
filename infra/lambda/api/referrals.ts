// User referrals: invite a friend, get +10 GB of Lens storage.
//
// Rule (user decision 2026-10-09, loose for launch): the reward is granted when
// the invited friend signs in (verified email or Google) on a phone that has
// never been rewarded before. No cap on invites; instead:
//  - each email (canonical: Gmail dots/+tags ignored) and each phone
//    (fingerprint) can earn a reward for somebody only once, ever
//    (RW#email#<email> / RW#fp#<fingerprint> markers, written in the same
//    transaction as the grant);
//  - no self-referrals (same phone or same email as the inviter);
//  - emulators never count;
//  - a burst of rewards for one inviter (more than VELOCITY_PER_DAY a day) is
//    held for review in /admin instead of granted;
//  - everything is in the audit log.
//
// Keys:  D#<inviter>  RF#<friend>         the friend's progress (joined → rewarded / held / rejected)
//        D#<user>     BN#<time>#<id>      storage bonus ledger (+/- bytes); PROFILE.bonusBytes = sum
//        D#<user>     PROFILE.referralCode, .fps (phone fingerprints signed in), .referral (state)
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { DeleteCommand, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { Attribution, attribute, canonicalEmail, createCode, lookupCode, today } from './attribution';
import { audit } from './audit';
import type { Identity } from './identity';
import { ddb, env, HttpError, json, randomId, Req, Res } from './lib';

const GB = 1024 ** 3;
export const referralSettings = {
  /** Inviter's reward per friend. */
  inviterBytes: Number(process.env.REFERRAL_BONUS_GB ?? 10) * GB,
  /** Friend's welcome bonus (0 = off). */
  friendBytes: Number(process.env.REFEREE_BONUS_GB ?? 0) * GB,
  /** Typed codes are accepted this long after the account was created. */
  claimWindowMs: 7 * 86400_000,
  /** A friend must sign in on a phone within this long of joining. */
  rewardWindowMs: 30 * 86400_000,
};
const VELOCITY_PER_DAY = Number(process.env.REFERRAL_VELOCITY_PER_DAY ?? 10);

const ses = new SESv2Client({});
const profileKey = (id: string) => ({ pk: `D#${id}`, sk: 'PROFILE' });

async function getProfile(id: string): Promise<Record<string, any> | undefined> {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: profileKey(id) }))).Item;
}

/** The friend's row on the inviter's side (what the invite screen lists). */
async function setFriend(inviterId: string, friendId: string, fields: Record<string, unknown>) {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':now': Date.now() };
  const sets = Object.entries(fields).map(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    return `#f${i} = :v${i}`;
  });
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `D#${inviterId}`, sk: `RF#${friendId}` },
      UpdateExpression: `SET ${[...sets, 'updatedAt = :now', 'createdAt = if_not_exists(createdAt, :now)'].join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** Runs a referral/affiliate step without ever breaking sign-up or sign-in. */
export async function rewardsHook(step: () => Promise<unknown>) {
  try {
    await step();
  } catch (error) {
    console.error('rewards hook failed', error);
  }
}

/** Called when an identity gets an attribution (any program); records the friend row for referrals. */
export async function onAttributed(identityId: string, attribution: Attribution | undefined) {
  if (attribution?.program !== 'referral') return;
  const profile = await getProfile(identityId);
  await setFriend(attribution.ownerId, identityId, { friendName: profile?.name ?? 'New friend', state: 'joined', source: attribution.source });
}

/** A guest that turned out to be an existing account (merged): not a new friend. */
export async function forgetGuest(guestId: string) {
  const attribution = (await getProfile(guestId))?.attribution as Attribution | undefined;
  if (attribution?.program !== 'referral') return;
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `D#${attribution.ownerId}`, sk: `RF#${guestId}` } }));
}

/**
 * A phone signed in to `accountId` (first sign-in, or an existing account on a
 * new phone). Remembers the phone and checks whether the inviter earns the reward.
 */
export async function onPhoneSignIn(accountId: string, fingerprint: string | undefined) {
  if (fingerprint) {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: profileKey(accountId),
        UpdateExpression: 'ADD fps :f',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':f': new Set([fingerprint]) },
      }),
    );
  }
  await evaluateReferral(accountId);
}

type Verdict = { ok: true; fingerprint: string } | { ok: false; reason: string; final: boolean };

async function check(friend: Record<string, any>, attribution: Attribution, inviter: Record<string, any> | undefined): Promise<Verdict> {
  if (!inviter || inviter.deleting) return { ok: false, reason: 'inviter-gone', final: true };
  if (!friend.email) return { ok: false, reason: 'not-signed-in', final: false };
  if (Date.now() - attribution.at > referralSettings.rewardWindowMs) return { ok: false, reason: 'too-late', final: true };
  const friendEmail = canonicalEmail(friend.email);
  if (inviter.email && canonicalEmail(inviter.email) === friendEmail) return { ok: false, reason: 'self', final: true };
  const inviterFps = new Set<string>([...(inviter.fps ?? []), ...(inviter.fingerprint ? [inviter.fingerprint] : [])]);
  const fps: string[] = [...(friend.fps ?? [])];
  if (fps.length === 0) return { ok: false, reason: 'no-phone-yet', final: false };
  if (fps.some((f) => inviterFps.has(f))) return { ok: false, reason: 'self', final: true };
  // The first phone that is real and has never earned anyone a reward.
  let emulators = 0;
  for (const fp of fps) {
    const device = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `FP#${fp}`, sk: 'DEVICE' } }))).Item;
    if (device?.emulator) {
      emulators++;
      continue;
    }
    const used = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `RW#fp#${fp}`, sk: 'REWARD' } }))).Item;
    if (!used) return { ok: true, fingerprint: fp };
  }
  return { ok: false, reason: emulators === fps.length ? 'emulator' : 'device-used', final: false };
}

/** Grants the reward if every rule passes. Safe to call any number of times. */
export async function evaluateReferral(friendId: string, opts: { release?: string } = {}): Promise<string> {
  const friend = await getProfile(friendId);
  const attribution = friend?.attribution as Attribution | undefined;
  if (!friend || attribution?.program !== 'referral') return 'none';
  const state = friend.referral as string | undefined;
  if (state === 'rewarded' || state === 'rejected') return state;
  if (state === 'held' && !opts.release) return state;

  const inviter = await getProfile(attribution.ownerId);
  const verdict = await check(friend, attribution, inviter);
  if (!verdict.ok) {
    const reason = verdict.reason;
    if (verdict.final) await finish(friendId, attribution.ownerId, 'rejected', { reason });
    else if (friend.email) await setFriend(attribution.ownerId, friendId, { state: 'signed-in', waiting: reason });
    return verdict.final ? 'rejected' : 'waiting';
  }

  // Velocity: an unusual burst for one inviter waits for a human.
  if (!opts.release) {
    const burst = await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `RATE#refgrant#${attribution.ownerId}#${today()}`, sk: 'COUNT' },
        UpdateExpression: 'ADD #c :one SET #ttl = :ttl',
        ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':ttl': Math.floor(Date.now() / 1000) + 3 * 86400 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    if ((burst.Attributes?.count ?? 0) > VELOCITY_PER_DAY) {
      await finish(friendId, attribution.ownerId, 'held', { reason: 'velocity' });
      return 'held';
    }
  }
  return grant(friend, friendId, attribution, verdict.fingerprint, opts.release ?? 'system');
}

async function finish(friendId: string, inviterId: string, state: 'rejected' | 'held', data: Record<string, unknown>) {
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: profileKey(friendId),
      UpdateExpression: 'SET referral = :s',
      ExpressionAttributeValues: { ':s': state },
    }),
  );
  await setFriend(inviterId, friendId, { state, ...data });
  if (state === 'held') {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${inviterId}`, sk: `RF#${friendId}` },
        UpdateExpression: 'SET gsi1pk = :g, gsi1sk = :s',
        ExpressionAttributeValues: { ':g': 'REF_HELD', ':s': `${Date.now()}#${friendId}` },
      }),
    );
  }
  await audit({ entity: `referral:${friendId}`, action: `referral.${state}`, actor: 'system', data: { inviterId, ...data } });
}

function bonusPut(userId: string, bytes: number, reason: string, refId: string) {
  return [
    {
      Put: {
        TableName: env.table,
        Item: { pk: `D#${userId}`, sk: `BN#${String(Date.now()).padStart(15, '0')}#${randomId(4)}`, bytes, reason, refId, at: Date.now() },
      },
    },
    {
      Update: {
        TableName: env.table,
        Key: profileKey(userId),
        UpdateExpression: 'ADD bonusBytes :b',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':b': bytes },
      },
    },
  ];
}

async function grant(friend: Record<string, any>, friendId: string, attribution: Attribution, fingerprint: string, actor: string): Promise<string> {
  const inviterId = attribution.ownerId;
  const email = canonicalEmail(friend.email);
  const marker = (pk: string) => ({
    Put: {
      TableName: env.table,
      Item: { pk, sk: 'REWARD', friendId, inviterId, at: Date.now() },
      ConditionExpression: 'attribute_not_exists(pk)',
    },
  });
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          marker(`RW#email#${email}`),
          marker(`RW#fp#${fingerprint}`),
          {
            Update: {
              TableName: env.table,
              Key: profileKey(friendId),
              UpdateExpression: 'SET referral = :r',
              ConditionExpression: 'attribute_not_exists(referral) OR referral <> :r',
              ExpressionAttributeValues: { ':r': 'rewarded' },
            },
          },
          ...bonusPut(inviterId, referralSettings.inviterBytes, 'referral', friendId),
          ...(referralSettings.friendBytes > 0 ? bonusPut(friendId, referralSettings.friendBytes, 'welcome', inviterId) : []),
        ],
      }),
    );
  } catch (error: any) {
    if (error?.name !== 'TransactionCanceledException') throw error;
    // An email/phone already earned a reward, or this one was granted meanwhile.
    const reasons: string[] = (error.CancellationReasons ?? []).map((r: any) => r?.Code);
    if (reasons[2] === 'ConditionalCheckFailed') return 'rewarded';
    const reason = reasons[0] === 'ConditionalCheckFailed' ? 'email-used' : 'device-used';
    if (reason === 'email-used') await finish(friendId, inviterId, 'rejected', { reason });
    else await setFriend(inviterId, friendId, { state: 'signed-in', waiting: reason });
    return reason === 'email-used' ? 'rejected' : 'waiting';
  }
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `D#${inviterId}`, sk: `RF#${friendId}` },
      UpdateExpression: 'SET #s = :s, bytes = :b, rewardedAt = :n, updatedAt = :n REMOVE gsi1pk, gsi1sk, waiting',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':s': 'rewarded', ':b': referralSettings.inviterBytes, ':n': Date.now() },
    }),
  );
  await audit({
    entity: `referral:${friendId}`,
    action: 'referral.rewarded',
    actor,
    data: { inviterId, code: attribution.code, inviterBytes: referralSettings.inviterBytes, friendBytes: referralSettings.friendBytes },
  });
  const inviter = await getProfile(inviterId);
  if (inviter?.email) {
    await notify(
      inviter.email,
      `+${Math.round(referralSettings.inviterBytes / GB)} GB added to your Lens storage`,
      `${friend.name ?? 'Your friend'} joined Lens with your invite, so we added ${Math.round(referralSettings.inviterBytes / GB)} GB to your storage. Thank you for spreading the word!\n\nInvite more friends from Settings → Invite friends.`,
    ).catch((e) => console.error('referral email', e));
  }
  return 'rewarded';
}

export async function notify(to: string, subject: string, text: string) {
  if (!env.codeSender || to.endsWith('@e2e.lens.invalid')) return;
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: `Lens <${env.codeSender}>`,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
    }),
  );
}

// ---------- API ----------

function inviteLink(code: string) {
  return `${env.webOrigin}/r/${code}`;
}

/** GET /v1/referrals: my invite code + link, friends and storage earned. Signed-in accounts only. */
export async function myReferrals(identity: Identity): Promise<Res> {
  if (!identity.email) throw new HttpError(403, 'Sign in to invite friends and earn storage', 'sign-in');
  const profile = await getProfile(identity.id);
  let code = profile?.referralCode as string | undefined;
  if (!code) {
    code = (await createCode(identity.id, 'referral')).code;
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.table,
          Key: profileKey(identity.id),
          UpdateExpression: 'SET referralCode = :c',
          ConditionExpression: 'attribute_not_exists(referralCode)',
          ExpressionAttributeValues: { ':c': code },
        }),
      );
    } catch (error: any) {
      if (error?.name !== 'ConditionalCheckFailedException') throw error;
      code = (await getProfile(identity.id))!.referralCode as string; // a parallel request won
    }
  }
  const rows = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':s': 'RF#' },
    }),
  );
  const friends = (rows.Items ?? [])
    .map((r) => ({
      name: r.friendName as string,
      // Simple states for the app; internal fraud reasons stay private.
      state: r.state === 'rewarded' ? 'rewarded' : r.state === 'joined' ? 'joined' : r.state === 'rejected' ? 'not-eligible' : 'signed-in',
      bytes: (r.bytes as number) ?? 0,
      at: (r.createdAt as number) ?? 0,
    }))
    .sort((a, b) => b.at - a.at);
  const attribution = profile?.attribution as Attribution | undefined;
  const canClaim = !attribution && Date.now() - ((profile?.createdAt as number) ?? 0) < referralSettings.claimWindowMs;
  return json(200, {
    code,
    link: inviteLink(code),
    rewardBytes: referralSettings.inviterBytes,
    friendBonusBytes: referralSettings.friendBytes,
    earnedBytes: friends.reduce((s, f) => s + f.bytes, 0),
    bonusBytes: profile?.bonusBytes ?? 0,
    friends,
    canClaim,
  });
}

/** POST /v1/referrals/claim {code}: "I have a code" within 7 days of joining. */
export async function claimCode(identity: Identity, req: Req): Promise<Res> {
  const profile = await getProfile(identity.id);
  if (!profile) throw new HttpError(404, 'Not found');
  if (profile.attribution) throw new HttpError(409, 'You already joined with a code');
  if (Date.now() - (profile.createdAt ?? 0) > referralSettings.claimWindowMs) {
    throw new HttpError(409, 'Codes can be added within 7 days of joining');
  }
  const record = await lookupCode(req.body?.code);
  if (!record) throw new HttpError(404, 'That code isn’t valid');
  if (record.ownerId === identity.id) throw new HttpError(400, 'That’s your own code');
  const attribution = await attribute(identity.id, req, record.code, 'typed');
  if (!attribution) throw new HttpError(400, 'That code can’t be used');
  await onAttributed(identity.id, attribution);
  const state = await evaluateReferral(identity.id);
  return json(200, { program: attribution.program, state });
}

// ---------- Admin ----------

/** GET /v1/admin/referrals/held: rewards waiting for review. */
export async function heldReferrals(): Promise<Res> {
  const rows = await ddb.send(
    new QueryCommand({ TableName: env.table, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :g', ExpressionAttributeValues: { ':g': 'REF_HELD' } }),
  );
  return json(200, {
    held: (rows.Items ?? []).map((r) => ({
      inviterId: (r.pk as string).slice(2),
      friendId: (r.sk as string).slice(3),
      friendName: r.friendName,
      reason: r.reason,
      at: r.updatedAt,
    })),
  });
}

/** POST /v1/admin/referrals/<friendId> {action: "release" | "reject", note?}. */
export async function decideReferral(adminId: string, friendId: string, req: Req): Promise<Res> {
  const friend = await getProfile(friendId);
  const attribution = friend?.attribution as Attribution | undefined;
  if (!friend || attribution?.program !== 'referral' || friend.referral !== 'held') throw new HttpError(404, 'Nothing held for this user');
  const note = String(req.body?.note ?? '').slice(0, 300);
  if (req.body?.action === 'release') {
    const state = await evaluateReferral(friendId, { release: `admin:${adminId}` });
    await audit({ entity: `referral:${friendId}`, action: 'referral.released', actor: `admin:${adminId}`, data: { note, state } });
    return json(200, { state });
  }
  if (req.body?.action === 'reject') {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${attribution.ownerId}`, sk: `RF#${friendId}` },
        UpdateExpression: 'REMOVE gsi1pk, gsi1sk',
      }),
    );
    await finish(friendId, attribution.ownerId, 'rejected', { reason: 'admin', note });
    return json(200, { state: 'rejected' });
  }
  throw new HttpError(400, 'action must be release or reject');
}
