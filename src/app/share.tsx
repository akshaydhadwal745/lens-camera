import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Person } from '@/lib/api';
import { selectGallery, useStore } from '@/lib/store';
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

export default function ShareScreen() {
  const insets = useSafeAreaInsets();
  const { ids } = useLocalSearchParams<{ ids?: string }>();
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

  useEffect(() => {
    api
      .contacts()
      .then((r) => setRecent(r.contacts))
      .catch(() => {});
  }, []);

  // Debounced name search.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
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
    if (!chosen.size || !ready.length) return;
    setSending(true);
    try {
      const result = await api.share(ready, [...chosen.keys()]);
      notify('Sent', `${result.shared} item${result.shared === 1 ? '' : 's'} sent to ${result.recipients.join(', ')}`);
      router.back();
    } catch (error) {
      notify('Could not send', errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const showingSearch = query.trim().length >= 2;
  const list = showingSearch ? results : recent;
  const skipped = requested.length - ready.length;

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton}>
          <Text style={styles.headerAction}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>
          Send {ready.length} item{ready.length === 1 ? '' : 's'}
        </Text>
        <Pressable onPress={send} disabled={!chosen.size || !ready.length || sending} hitSlop={10} style={styles.headerButton}>
          {sending ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={[styles.headerAction, styles.bold, (!chosen.size || !ready.length) && { color: '#555' }]}>Send</Text>
          )}
        </Pressable>
      </View>

      {skipped > 0 && (
        <Text style={styles.note}>
          {skipped} item{skipped === 1 ? ' is' : 's are'} still uploading and will be skipped.
        </Text>
      )}

      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color="#888" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people by name"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          returnKeyType="search"
        />
        {searching && <ActivityIndicator size="small" color="#888" />}
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

      <Text style={styles.section}>{showingSearch ? 'Results' : 'Recent'}</Text>
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
              : `No recent people yet. Search for a friend's name above.${myName ? ` Yours is ${myName}.` : ''}`}
          </Text>
        }
        renderItem={({ item }) => {
          const on = chosen.has(item.id);
          return (
            <Pressable onPress={() => toggle(item)} style={styles.row} accessibilityState={{ selected: on }}>
              <Avatar name={item.name} />
              <Text style={styles.name}>{item.name}</Text>
              <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? colors.accent : '#555'} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0B0B0D' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 64, justifyContent: 'center' },
  headerAction: { color: colors.accent, fontSize: 17 },
  bold: { fontWeight: '700', textAlign: 'right' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  note: { color: '#FBBF24', fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 },
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
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accent, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: '#000', fontWeight: '600', fontSize: 13 },
  section: { color: '#888', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  name: { flex: 1, color: '#fff', fontSize: 16 },
  empty: { color: '#777', fontSize: 14, paddingHorizontal: 16, paddingTop: 12, lineHeight: 20 },
});
