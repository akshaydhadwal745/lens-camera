// People: your own photos grouped by face, on this phone only
// (docs/design/people.md). On by default where allowed; in the EU/UK/US (or after
// the user turned it off) one tap turns it on. Grouping happens while the phone
// charges; names are private labels. "Turn off" deletes all face data.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearFaceThumbs, FaceThumb } from '@/components/FaceThumb';
import { Text } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { peopleSupported, photoCount, turnPeopleOff, turnPeopleOn } from '@/lib/people';
import { SmartLink, smartLinkAnswered, smartLinkSuggestion } from '@/lib/people-smart-link';
import { font, palette } from '@/lib/theme';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';
import { LensPeople, PeopleGroup, PeopleStatus } from '../../modules/lens-camera';
import { handleOf, who } from '@/lib/names';

type Ask = { faceId: number; groupId: number; photoId: string; name: string };

export default function PeopleScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [status, setStatus] = useState<PeopleStatus | null>(null);
  const [groups, setGroups] = useState<PeopleGroup[]>([]);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [smart, setSmart] = useState<SmartLink | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!LensPeople) return;
    const s = await LensPeople.status();
    setStatus(s);
    if (!s.on) return;
    const g = await LensPeople.groups(3, false);
    setGroups(g);
    const names = new Map(g.map((x) => [x.id, x.name]));
    const a = await LensPeople.asks(5);
    setAsks(a.map((x) => ({ ...x, name: names.get(x.groupId) ?? 'this person' })));
    // Smart link: needs every group (also 1–2 photos) and the people you shared with.
    const all = await LensPeople.groups(1, false);
    const friends = await api.contacts().then((r) => r.contacts, () => []);
    setSmart(await smartLinkSuggestion(all, friends));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch((e) => notify('Could not load People', errorMessage(e)));
    }, [load]),
  );

  const turnOn = async () => {
    setBusy(true);
    try {
      await turnPeopleOn();
      await load();
    } catch (e) {
      notify('Could not turn on People', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteAll = async () => {
    const ok = await confirmDestructive(
      'Turn off People?',
      'Every face group and name is deleted from this phone. Your photos stay.',
      'Turn off',
    );
    if (!ok) return;
    await turnPeopleOff();
    clearFaceThumbs();
    setGroups([]);
    setAsks([]);
    setSmart(null);
    await load();
  };

  const answer = async (a: Ask, yes: boolean) => {
    if (yes) await LensPeople?.confirm(a.faceId, a.groupId);
    else await LensPeople?.reject(a.faceId, a.groupId);
    await load();
  };

  const answerSmart = async (link: SmartLink, yes: boolean) => {
    smartLinkAnswered(link);
    setSmart(null);
    if (yes) {
      await LensPeople?.setContact(link.groupId, link.friend.id);
      notify('Linked', link.friend.suggestMe ? `Lens can now suggest sharing their photos with ${who(link.friend)}.` : `When ${who(link.friend)} turns on suggestions, Lens can suggest sharing their photos.`);
    }
    await load();
  };

  const content = Math.min(width, 900);
  const cols = content >= 700 ? 5 : 3;
  const cell = Math.floor((content - 32 - (cols - 1) * 16) / cols);

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={26} color={colors.link} />
      </Pressable>
      <Text style={styles.title}>People</Text>
      <View style={styles.headerButton} />
    </View>
  );

  if (!peopleSupported) {
    return (
      <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
        {header}
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={52} color={palette.surface3} />
          <Text style={styles.emptyTitle}>Not on this phone</Text>
          <Text style={styles.emptyBody}>People needs Google Play services, which this phone doesn&apos;t have.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      {header}
      {status === null ? (
        <ActivityIndicator color={palette.text} style={{ marginTop: 40 }} />
      ) : !status.on ? (
        <View style={{ padding: 24, width: Math.min(width, 560), alignSelf: 'center' }}>
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={52} color={palette.surface3} />
            <Text style={styles.emptyTitle}>See your photos by person</Text>
            <Text style={styles.cardBody}>
              Lens groups faces in your photos on this phone while it charges. Face data is never uploaded, and you can turn it off anytime.
            </Text>
          </View>
          <Pressable style={[styles.primary, busy && { opacity: 0.6 }]} onPress={() => void turnOn()} disabled={busy} accessibilityRole="button">
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.primaryText}>Getting the face engine…</Text>
              </View>
            ) : (
              <Text style={styles.primaryText}>Turn on</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, width: content, alignSelf: 'center' }}>
          <Text style={styles.statusLine}>
            {status.waiting
              ? 'STARTS AT THE NEXT CHARGE ON WI-FI'
              : (status.photos ?? 0) < status.ownPhotos
              ? `GROUPING WHILE CHARGING · ${status.photos ?? 0} OF ${status.ownPhotos} PHOTOS`
              : `${status.ownPhotos} PHOTOS · ALL GROUPED`}
          </Text>

          {smart ? (
            <View style={styles.ask}>
              <FaceThumb faceId={smart.coverFaceId} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={styles.askText}>Is this {who(smart.friend)}?</Text>
                <Text style={styles.askHint}>
                  {handleOf(smart.friend) ? `${handleOf(smart.friend)} · ` : ''}In {smart.shared} of the {smart.withFace} photos with people you shared with them. Link so Lens can suggest shares.
                </Text>
              </View>
              <Pressable style={styles.askButton} onPress={() => void answerSmart(smart, false)} accessibilityRole="button">
                <Text style={styles.askButtonText}>No</Text>
              </Pressable>
              <Pressable style={[styles.askButton, { backgroundColor: colors.action }]} onPress={() => void answerSmart(smart, true)} accessibilityRole="button">
                <Text style={styles.askButtonText}>Yes</Text>
              </Pressable>
            </View>
          ) : null}

          {asks.map((a) => (
            <View key={a.faceId} style={styles.ask}>
              <FaceThumb faceId={a.faceId} size={48} />
              <Text style={styles.askText}>Is this {a.name}?</Text>
              <Pressable style={styles.askButton} onPress={() => void answer(a, false)} accessibilityRole="button">
                <Text style={styles.askButtonText}>No</Text>
              </Pressable>
              <Pressable style={[styles.askButton, { backgroundColor: colors.action }]} onPress={() => void answer(a, true)} accessibilityRole="button">
                <Text style={styles.askButtonText}>Yes</Text>
              </Pressable>
            </View>
          ))}

          {groups.length === 0 ? (
            <Text style={styles.emptyBody}>
              {status.ownPhotos === 0
                ? 'Take some photos of people: they show up here, grouped by face.'
                : 'Faces show up here once your phone has charged for a while. People appear when they are in at least 3 photos.'}
            </Text>
          ) : (
            <View style={styles.grid}>
              {groups.map((g) => (
                <Pressable
                  key={g.id}
                  style={{ width: cell, alignItems: 'center' }}
                  onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(g.id) } })}
                  accessibilityRole="button"
                  accessibilityLabel={g.name ?? 'Unnamed person'}
                >
                  <FaceThumb faceId={g.coverFaceId} size={cell} />
                  <Text style={[styles.name, !g.name && styles.unnamed]} numberOfLines={1}>
                    {g.name ?? 'Add name'}
                  </Text>
                  <Text style={styles.meta}>{photoCount(g.photos)}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable style={styles.footer} onPress={() => void deleteAll()} accessibilityRole="button" accessibilityLabel="Turn off People and delete face data">
            <Text style={styles.fine}>
              Grouped on this phone, never uploaded · <Text style={styles.footerLink}>Turn off</Text>
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyTitle: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: '#86868B', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 12, paddingVertical: 24 },
  primary: { marginTop: 20, backgroundColor: colors.action, borderRadius: 980, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  fine: { color: '#86868B', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 12 },
  statusLine: { color: '#86868B', fontSize: 11, letterSpacing: 1, fontFamily: font.mono, marginBottom: 14 },
  ask: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1C1C1E', borderRadius: 20, padding: 12, marginBottom: 10 },
  askText: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  askHint: { color: '#86868B', fontSize: 12, lineHeight: 16, marginTop: 2 },
  askButton: { minHeight: 40, minWidth: 56, paddingHorizontal: 14, borderRadius: 980, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' },
  askButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 6 },
  name: { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 8 },
  unnamed: { color: colors.link },
  meta: { color: '#86868B', fontSize: 12, marginTop: 2 },
  footer: { marginTop: 32, minHeight: 44, justifyContent: 'center' },
  footerLink: { color: colors.link, fontSize: 12 },
  cardBody: { color: '#86868B', fontSize: 15, lineHeight: 21, textAlign: 'center', paddingHorizontal: 8 },
});
