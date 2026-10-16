// People smart link (docs/design/people.md): when one face group fills most of
// the photos you shared with one friend, ask once "Is this quiet-tiger-8703?".
// Only on the phone, from your own share history; never linked without a yes.
import type { Contact } from './api';
import { api } from './api';
import { loadDoc, saveDoc } from './local-store';
import { LensPeople, PeopleGroup } from '../../modules/lens-camera';

export type SmartLink = { groupId: number; coverFaceId: number; friend: Contact; shared: number; withFace: number };

/** Shared photos of this friend that show the group; fewer than this is chance. */
const MIN_PHOTOS = 3;
/** Share of the friend's shared photos with faces that show the group. */
const MIN_RATIO = 0.6;
const ASKED_DOC = 'people-smart-link-asked';

/**
 * Pure: the best (group, friend) pair, or null. A group that fills the photos
 * shared with two or more friends is left out: that is usually you (selfies) or a
 * common friend. A "No" (asked) moves on to the next group for that friend.
 */
export function findSmartLink(
  groups: PeopleGroup[],
  photosByGroup: Map<number, Set<string>>,
  friends: Contact[],
  sharedByFriend: Map<string, Set<string>>,
  asked: Set<string>,
): SmartLink | null {
  const linkedFriends = new Set(groups.map((g) => g.contactId).filter(Boolean));
  const open = groups.filter((g) => !g.hidden && !g.contactId);
  const withAnyFace = new Set<string>();
  for (const photos of photosByGroup.values()) for (const p of photos) withAnyFace.add(p);

  const candidates = friends
    .filter((f) => !linkedFriends.has(f.id))
    .map((friend) => {
      const shared = [...(sharedByFriend.get(friend.id) ?? [])].filter((id) => withAnyFace.has(id));
      const counts = open
        .map((g) => ({ g, n: shared.filter((id) => photosByGroup.get(g.id)?.has(id)).length }))
        .sort((a, b) => b.n - a.n);
      return { friend, shared: shared.length, counts };
    })
    .filter((c) => c.shared >= MIN_PHOTOS);
  const fills = (n: number, shared: number) => n >= MIN_PHOTOS && n / shared >= MIN_RATIO;
  const fillCount = new Map<number, number>();
  for (const c of candidates) for (const { g, n } of c.counts) if (fills(n, c.shared)) fillCount.set(g.id, (fillCount.get(g.id) ?? 0) + 1);

  const matches: SmartLink[] = [];
  for (const c of candidates) {
    const ranked = c.counts.filter(({ g }) => (fillCount.get(g.id) ?? 0) < 2 && !asked.has(`${g.id}:${c.friend.id}`));
    const best = ranked[0];
    if (!best || !fills(best.n, c.shared)) continue;
    // A clear winner only: two people in every photo can't be told apart this way.
    if (ranked[1] && ranked[1].n >= best.n * 0.8) continue;
    matches.push({ groupId: best.g.id, coverFaceId: best.g.coverFaceId, friend: c.friend, shared: best.n, withFace: c.shared });
  }
  // One group can only be one friend.
  const perGroup = new Map<number, number>();
  for (const m of matches) perGroup.set(m.groupId, (perGroup.get(m.groupId) ?? 0) + 1);
  return matches.filter((m) => perGroup.get(m.groupId) === 1).sort((a, b) => b.shared - a.shared)[0] ?? null;
}

/** Up to 150 sent requests: friend id → my item ids they accepted. */
async function sharedHistory(): Promise<Map<string, Set<string>>> {
  const byFriend = new Map<string, Set<string>>();
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const r = await api.sharesOut(cursor);
    for (const s of r.requests) {
      if (s.status !== 'accepted' || !s.mediaIds) continue;
      const set = byFriend.get(s.to.id) ?? new Set<string>();
      for (const id of s.mediaIds) set.add(id);
      byFriend.set(s.to.id, set);
    }
    cursor = r.cursor;
    if (!cursor) break;
  }
  return byFriend;
}

/** People screen: the one pair to ask about now, or null (also on any error). */
export async function smartLinkSuggestion(groups: PeopleGroup[], friends: Contact[]): Promise<SmartLink | null> {
  if (!LensPeople || !friends.length || !groups.some((g) => !g.contactId && !g.hidden)) return null;
  try {
    const sharedByFriend = await sharedHistory();
    if (!sharedByFriend.size) return null;
    const photosByGroup = new Map<number, Set<string>>();
    for (const g of groups) photosByGroup.set(g.id, new Set((await LensPeople.groupPhotos(g.id)).map((f) => f.photoId)));
    return findSmartLink(groups, photosByGroup, friends, sharedByFriend, new Set(loadDoc<string[]>(ASKED_DOC, [])));
  } catch {
    return null;
  }
}

/** Remember the answer: this pair is never asked again (a yes links it, so it won't come up anyway). */
export function smartLinkAnswered(link: SmartLink) {
  const asked = loadDoc<string[]>(ASKED_DOC, []);
  saveDoc(ASKED_DOC, [...asked, `${link.groupId}:${link.friend.id}`].slice(-200));
}
