import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Person } from '@/lib/api';
import { onPersonPicked } from '@/lib/person-code';
import { askForNotifications } from '@/lib/push';
import { useNearbyPeople } from '@/lib/nearby';
import { queueShare, selectGallery, useStore } from '@/lib/store';
import { colors, errorMessage, notify } from '@/lib/ui';

function Avatar({ name }: { name: string }) {
  // Deterministic color from the name.
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <View style={[styles.avatar, { backgroundColor: `hsl(${hue}, 55%, 40%)` }]}>
      <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/** What tells look-alike names apart: signed-in account vs guest phone, and whether you've shared before. */
function PersonFacts({ person }: { person: Person }) {
  const facts = [
    person.account === undefined ? null : person.account ? 'Signed-in account' : 'Guest phone',
    person.sharedBefore || person.lastSharedAt ? 'Shared before' : person.account === undefined ? null : 'New to you',
  ].filter(Boolean);
  if (!facts.length) return null;
  return <Text style={styles.facts}>{facts.join(' · ')}</Text>;
}

export default function ShareScreen() {
  const insets = useSafeAreaInsets();
  // Picked items (?ids=) or a whole album (?album=&albumName=&albumCount=).
  // to: a contact id to preselect (People's "Share 8 photos with Riya?" suggestion).
  const { ids, album, albumName, albumCount, to } = useLocalSearchParams<{ ids?: string; album?: string; albumName?: string; albumCount?: string; to?: string }>();
  const gallery = useStore(selectGallery);
  const myName = useStore((s) => s.identity?.name);

  const requested = useMemo(() => (ids ?? '').split(',').filter(Boolean), [ids]);
  const ready = useMemo(
    () => requested.filter((id) => gallery.find((g) => g.id === id)?.sync === 'synced'),
    [requested, gallery],
  );

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [recent, setRecent] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<Map<string, Person>>(new Map());
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Location stays private by default: recipients get photos without the GPS position.
  const [includeLocation, setIncludeLocation] = useState(false);

  useEffect(() => {
    api
      .contacts()
      // Suggestions: who you share with most, then most recent.
      .then((r) => {
        const people = [...r.contacts]
          .sort((a, b) => (b.shares ?? 0) - (a.shares ?? 0) || b.lastSharedAt - a.lastSharedAt)
          .map((c) => ({ ...c, sharedBefore: true }));
        setRecent(people);
        const pre = to ? people.find((c) => c.id === to) : undefined;
        if (pre) setChosen(new Map([[pre.id, pre]]));
      })
      .catch(() => {});
  }, [to]);

  // A friend's scanned "My Lens code" (Scan code): exactly that person.
  useEffect(
    () =>
      onPersonPicked((person) => {
        setChosen((prev) => new Map(prev).set(person.id, person));
        setQuery('');
      }),
    [],
  );

  // Debounced name search.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    // 3+ letters: two-letter prefixes match too many look-alike names.
    if (q.length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .searchUsers(q)
        .then((r) => setResults(r.users))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const toggle = (person: Person) => {
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(person.id)) next.delete(person.id);
      else next.set(person.id, person);
      return next;
    });
  };

  const send = async () => {
    if (!chosen.size || (!count && !requested.length)) return;
    setSending(true);
    try {
      const to = [...chosen.keys()];
      // Still uploading: queued, sent to the same people the moment each reaches the cloud.
      const later = album ? [] : requested.filter((id) => !ready.includes(id));
      if (later.length) queueShare(later, to);
      const result = album
        ? await api.shareAlbum(album, to, includeLocation)
        : ready.length
          ? await api.share(ready, to, includeLocation)
          : { shared: 0, recipients: [...chosen.values()].map((p) => p.name), requests: [] };
      const requests = result.requests ?? [];
      const waiting = requests.filter((r) => r.status === 'pending').map((r) => r.name);
      const auto = requests.filter((r) => r.status === 'accepted').map((r) => r.name);
      const items = album ? `the album “${albumName ?? 'Album'}”` : `${result.shared} item${result.shared === 1 ? '' : 's'}`;
      notify(
        'Sent',
        [
          waiting.length ? `${waiting.join(', ')} will be asked to accept ${items}. You can cancel in Shared → Sent until they do.` : '',
          auto.length ? `${auto.join(', ')} accept everything from you: shared now.` : '',
        ]
          .filter(Boolean)
          .concat(later.length ? [`${later.length} still uploading: they go to the same people as soon as they're in the cloud.`] : [])
          .join('\n\n') || `${items} sent to ${result.recipients.join(', ')}`,
      );
      setConfirming(false);
      // Hear back when they accept (asked once, at a moment it makes sense).
      void askForNotifications();
      router.back();
    } catch (error) {
      notify('Could not send', errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  // People on this Wi-Fi who are visible (verified by the server), shown first.
  const nearby = useNearbyPeople(true);
  const showingSearch = query.trim().length >= 3;
  const list = showingSearch ? results : recent;
  // Picked photos that carry a GPS position (from Places): the confirm sheet offers to include it.
  const located = album ? 0 : requested.filter((id) => gallery.find((g) => g.id === id)?.hasGps).length;
  // Album mode: the album's items; otherwise the picked items already in the cloud.
  const count = album ? Number(albumCount ?? 0) : requested.length;
  const skipped = album ? 0 : requested.length - ready.length;

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton}>
          <Text style={styles.headerAction}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>
          {album ? `Share “${albumName ?? 'Album'}”` : `Send ${count} item${count === 1 ? '' : 's'}`}
        </Text>
        <Pressable onPress={() => setConfirming(true)} disabled={!chosen.size || !count || sending} hitSlop={10} style={styles.headerButton}>
          {sending ? (
            <ActivityIndicator color={colors.link} />
          ) : (
            <Text style={[styles.headerAction, styles.bold, (!chosen.size || !count) && { color: '#636366' }]}>Send</Text>
          )}
        </Pressable>
      </View>

      {skipped > 0 && (
        <Text style={styles.note}>
          {skipped} item{skipped === 1 ? ' is' : 's are'} still uploading: {skipped === 1 ? 'it goes' : 'they go'} out as soon as {skipped === 1 ? "it's" : "they're"} in the cloud.
        </Text>
      )}

      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color="#86868B" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Full Lens name, e.g. quiet-tiger-8703"
          placeholderTextColor="#636366"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          returnKeyType="search"
        />
        {searching && <ActivityIndicator size="small" color="#86868B" />}
        {Platform.OS !== 'web' && (
          <Pressable onPress={() => router.push({ pathname: '/scan', params: { for: 'person' } })} hitSlop={8} accessibilityLabel="Scan a friend's Lens code">
            <Ionicons name="qr-code-outline" size={20} color={colors.link} />
          </Pressable>
        )}
      </View>

      {chosen.size > 0 && (
        <View style={styles.chips}>
          {[...chosen.values()].map((p) => (
            <Pressable key={p.id} onPress={() => toggle(p)} style={styles.chip}>
              <Text style={styles.chipText}>{p.name}</Text>
              <Ionicons name="close" size={14} color="#000" />
            </Pressable>
          ))}
        </View>
      )}

      {!showingSearch && nearby.length > 0 ? (
        <View>
          <Text style={styles.section}>Nearby on this Wi-Fi</Text>
          {nearby.map((p) => {
            const on = chosen.has(p.id);
            return (
              <Pressable key={p.id} onPress={() => toggle(p)} style={styles.row} accessibilityState={{ selected: on }}>
                <Avatar name={p.name} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{p.name}</Text>
                  <PersonFacts person={p} />
                </View>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? colors.link : '#636366'} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Text style={styles.section}>{showingSearch ? 'Results' : 'Suggested'}</Text>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {showingSearch
              ? searching
                ? ''
                : 'No one found with that name.'
              : `No recent people yet. Type a friend's full Lens name or scan their code.${myName ? ` Yours is ${myName}.` : ''}`}
          </Text>
        }
        renderItem={({ item }) => {
          const on = chosen.has(item.id);
          return (
            <Pressable onPress={() => toggle(item)} style={styles.row} accessibilityState={{ selected: on }}>
              <Avatar name={item.name} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <PersonFacts person={item} />
              </View>
              {item.exact ? <Text style={styles.exact}>Exact</Text> : null}
              <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? colors.link : '#636366'} />
            </Pressable>
          );
        }}
      />

      {/* Last look before anything is sent: exactly who, and what. */}
      <Modal visible={confirming} transparent animationType="fade" onRequestClose={() => setConfirming(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.sheetTitle}>
              {album ? `Share the album “${albumName ?? 'Album'}” (${count} item${count === 1 ? '' : 's'}) with` : `Share ${count} item${count === 1 ? '' : 's'} with`}
            </Text>
            {[...chosen.values()].map((p) => (
              <View key={p.id} style={styles.sheetRow}>
                <Avatar name={p.name} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{p.name}</Text>
                  <PersonFacts person={p} />
                </View>
              </View>
            ))}
            {located > 0 || album ? (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={18} color="#86868B" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.locationTitle}>Include where they were taken</Text>
                  <Text style={styles.sheetNote}>
                    {album ? 'Off: they get the photos without the location.' : `${located} of these ${located === 1 ? 'has' : 'have'} a saved location. Off: they get them without it.`}
                  </Text>
                </View>
                <Switch value={includeLocation} onValueChange={setIncludeLocation} />
              </View>
            ) : null}
            <Text style={styles.sheetNote}>They&apos;ll be asked to accept first. Until they do, you can cancel it in Shared → Sent; after that you can still revoke it.</Text>
            <View style={styles.sheetButtons}>
              <Pressable style={[styles.sheetButton, styles.sheetSecondary]} onPress={() => setConfirming(false)} disabled={sending}>
                <Text style={styles.sheetSecondaryText}>Back</Text>
              </Pressable>
              <Pressable style={[styles.sheetButton, styles.sheetPrimary]} onPress={send} disabled={sending}>
                {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetPrimaryText}>Share</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 64, justifyContent: 'center' },
  headerAction: { color: colors.link, fontSize: 17 },
  bold: { fontWeight: '700', textAlign: 'right' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  note: { color: '#FACC15', fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1C1C1E',
  },
  input: { flex: 1, color: '#fff', fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.text, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: '#000', fontWeight: '600', fontSize: 13 },
  section: { color: '#86868B', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  name: { flex: 1, color: '#fff', fontSize: 16 },
  empty: { color: '#86868B', fontSize: 14, paddingHorizontal: 16, paddingTop: 12, lineHeight: 20 },
  facts: { color: '#86868B', fontSize: 12, marginTop: 2 },
  exact: { color: '#000', backgroundColor: colors.text, fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1C1C1E', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12, width: '100%', maxWidth: 560, alignSelf: 'center' },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetNote: { color: '#86868B', fontSize: 13, lineHeight: 18 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: '#2C2C2E' },
  locationTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sheetButtons: { flexDirection: 'row', gap: 12, marginTop: 4 },
  sheetButton: { flex: 1, minHeight: 48, borderRadius: 980, alignItems: 'center', justifyContent: 'center' },
  sheetPrimary: { backgroundColor: colors.action },
  sheetPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sheetSecondary: { backgroundColor: '#2C2C2E' },
  sheetSecondaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
