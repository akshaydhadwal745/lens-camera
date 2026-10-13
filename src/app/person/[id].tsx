// One person from People (docs/design/people.md): their photos, newest first.
// Name = a private label on this phone. Long-press a photo: "Not this person".
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FaceThumb } from '@/components/FaceThumb';
import { MediaTile } from '@/components/MediaTile';
import { Text, TextInput } from '@/components/ui/Text';
import { api, Contact } from '@/lib/api';
import { photoCount } from '@/lib/people';
import { selectGallery, useStore } from '@/lib/store';
import { palette } from '@/lib/theme';
import type { GalleryItem } from '@/lib/types';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';
import { LensPeople, PeopleGroup } from '../../../modules/lens-camera';

const GAP = 3;

export default function PersonScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const gallery = useStore(selectGallery);
  const [group, setGroup] = useState<PeopleGroup | null>(null);
  const [faces, setFaces] = useState<{ photoId: string; faceId: number }[] | null>(null);
  const [others, setOthers] = useState<PeopleGroup[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [linking, setLinking] = useState(false);
  const [friends, setFriends] = useState<Contact[] | null>(null);
  /** When the page loaded: "this week" is counted from here (not during render). */
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    if (!LensPeople) return;
    const all = await LensPeople.groups(1, true);
    const me = all.find((g) => g.id === id) ?? null;
    setGroup(me);
    setOthers(all.filter((g) => g.id !== id && !g.hidden && g.photos >= 2));
    setFaces(me ? await LensPeople.groupPhotos(id) : []);
    // Lens friends (people you shared with): for "Link to Lens friend" and suggestions.
    api.contacts().then((r) => setFriends(r.contacts), () => setFriends([]));
    setLoadedAt(Date.now());
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load().catch((e) => notify('Could not load this person', errorMessage(e)));
    }, [load]),
  );

  const items = useMemo<{ item: GalleryItem; faceId: number }[] | null>(() => {
    if (!faces) return null;
    const byId = new Map(gallery.map((g) => [g.id, g]));
    const seen = new Set<string>();
    const out: { item: GalleryItem; faceId: number }[] = [];
    for (const f of faces) {
      const item = byId.get(f.photoId);
      if (item && !seen.has(f.photoId)) {
        seen.add(f.photoId);
        out.push({ item, faceId: f.faceId });
      }
    }
    return out;
  }, [faces, gallery]);

  const friend = group?.contactId ? friends?.find((f) => f.id === group.contactId) : undefined;
  // "Share 8 photos with Riya?": their photos from the last 7 days that are in the cloud,
  // only when Riya allows suggestions. Lens never sends anything without the confirm sheet.
  const suggestion = useMemo(() => {
    if (!friend?.suggestMe || !items || !loadedAt) return [];
    const since = loadedAt - 7 * 24 * 3600 * 1000;
    return items.filter((x) => x.item.createdAt >= since && x.item.sync === 'synced').map((x) => x.item.id);
  }, [friend, items, loadedAt]);

  const run = async (fn: () => Promise<unknown>, failure: string) => {
    try {
      await fn();
      await load();
    } catch (e) {
      notify(failure, errorMessage(e));
    }
  };

  const save = () =>
    run(async () => {
      await LensPeople?.rename(id, (renaming ?? '').trim() || null);
      setRenaming(null);
    }, 'Could not save the name');

  const notThis = async (faceId: number) => {
    const ok = await confirmDestructive('Not this person?', 'This photo leaves the group and won’t be added to it again.', 'Not this person');
    if (ok) await run(() => LensPeople!.notThis(faceId), 'Could not update');
  };

  const mergeWith = (other: PeopleGroup) =>
    run(async () => {
      // The named one keeps its name; otherwise this person's page stays.
      const keep = !group?.name && other.name ? other.id : id;
      await LensPeople?.merge(keep, keep === id ? other.id : id);
      setMerging(false);
      if (keep !== id) router.replace({ pathname: '/person/[id]', params: { id: String(keep) } });
    }, 'Could not merge');

  const content = Math.min(width, 900);
  const cols = content >= 700 ? 5 : 3;
  const tile = Math.floor((content - (cols - 1) * GAP) / cols);
  const title = group?.name ?? 'Unnamed person';

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.link} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerButton} />
      </View>
      {items === null || !group ? (
        group === null && faces ? (
          <Text style={styles.empty}>This person is no longer in your photos.</Text>
        ) : (
          <ActivityIndicator color={palette.text} style={{ marginTop: 40 }} />
        )
      ) : (
        <FlatList
          data={items}
          key={cols}
          numColumns={cols}
          keyExtractor={(x) => x.item.id}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + 40, width: content, alignSelf: 'center' }}
          ListHeaderComponent={
            <View style={styles.top}>
              <FaceThumb faceId={group.coverFaceId} size={88} />
              <Text style={styles.sub}>{photoCount(items.length)} · long-press a photo if it isn’t them</Text>
              <View style={styles.actions}>
                <Pressable style={[styles.action, !group.name && styles.actionPrimary]} onPress={() => setRenaming(group.name ?? '')} accessibilityRole="button">
                  <Ionicons name="pencil" size={15} color="#fff" />
                  <Text style={styles.actionText}>{group.name ? 'Rename' : 'Add name'}</Text>
                </Pressable>
                <Pressable style={styles.action} onPress={() => setLinking(true)} accessibilityRole="button">
                  <Ionicons name="link-outline" size={15} color="#fff" />
                  <Text style={styles.actionText} numberOfLines={1}>
                    {friend ? friend.name : 'Link to Lens friend'}
                  </Text>
                </Pressable>
                {others.length ? (
                  <Pressable style={styles.action} onPress={() => setMerging(true)} accessibilityRole="button">
                    <Ionicons name="git-merge-outline" size={15} color="#fff" />
                    <Text style={styles.actionText}>Same person as…</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.action} onPress={() => void run(() => LensPeople!.hide(id, !group.hidden), 'Could not update')} accessibilityRole="button">
                  <Ionicons name={group.hidden ? 'eye-outline' : 'eye-off-outline'} size={15} color="#fff" />
                  <Text style={styles.actionText}>{group.hidden ? 'Show in People' : 'Hide'}</Text>
                </Pressable>
              </View>
              {suggestion.length && friend ? (
                <Pressable
                  style={styles.suggest}
                  onPress={() => router.push({ pathname: '/share', params: { ids: suggestion.join(','), to: friend.id } })}
                  accessibilityRole="button"
                >
                  <Ionicons name="paper-plane-outline" size={18} color="#fff" />
                  <Text style={styles.suggestText}>
                    Share {photoCount(suggestion.length)} from this week with {group.name ?? friend.name}?
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <MediaTile
              item={item.item}
              size={tile}
              selecting={false}
              selected={false}
              onPress={(g) => router.push({ pathname: '/viewer/[id]', params: { id: g.id, source: 'mine' } })}
              onLongPress={() => void notThis(item.faceId)}
            />
          )}
        />
      )}

      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRenaming(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Name</Text>
            <Text style={styles.sheetHint}>A private label, only on this phone.</Text>
            <TextInput value={renaming ?? ''} onChangeText={setRenaming} style={styles.input} maxLength={40} autoFocus placeholder="e.g. Mom" placeholderTextColor="#636366" returnKeyType="done" onSubmitEditing={() => void save()} />
            <View style={styles.sheetButtons}>
              <Pressable style={[styles.sheetButton, { backgroundColor: '#2C2C2E' }]} onPress={() => setRenaming(null)}>
                <Text style={styles.sheetButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.sheetButton, { backgroundColor: colors.action }]} onPress={() => void save()}>
                <Text style={styles.sheetButtonText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={linking} transparent animationType="fade" onRequestClose={() => setLinking(false)}>
        <Pressable style={styles.backdrop} onPress={() => setLinking(false)}>
          <Pressable style={[styles.sheet, { maxHeight: '70%' }]} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Link to Lens friend</Text>
            <Text style={styles.sheetHint}>So Lens can suggest sharing their photos with them (if they allow it). Only on this phone.</Text>
            <ScrollView contentContainerStyle={{ gap: 6 }}>
              {(friends ?? []).length === 0 ? (
                <Text style={styles.sheetHint}>Share something with them first (or scan their Lens code); then they show up here.</Text>
              ) : (
                (friends ?? []).map((f) => (
                  <Pressable
                    key={f.id}
                    style={styles.mergeRow}
                    onPress={() => void run(async () => { await LensPeople?.setContact(id, f.id); setLinking(false); }, 'Could not link')}
                    accessibilityRole="button"
                  >
                    <Ionicons name={f.id === group?.contactId ? 'checkmark-circle' : 'person-circle-outline'} size={30} color={f.id === group?.contactId ? colors.action : '#86868B'} />
                    <Text style={styles.mergeName} numberOfLines={1}>
                      {f.name}
                    </Text>
                    {f.suggestMe ? <Text style={styles.meta}>suggestions on</Text> : null}
                  </Pressable>
                ))
              )}
              {group?.contactId ? (
                <Pressable style={styles.mergeRow} onPress={() => void run(async () => { await LensPeople?.setContact(id, null); setLinking(false); }, 'Could not unlink')} accessibilityRole="button">
                  <Text style={[styles.mergeName, { color: '#FF453A' }]}>Unlink</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={merging} transparent animationType="fade" onRequestClose={() => setMerging(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMerging(false)}>
          <Pressable style={[styles.sheet, { maxHeight: '70%' }]} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Same person as…</Text>
            <ScrollView contentContainerStyle={{ gap: 10 }}>
              {others.map((o) => (
                <Pressable key={o.id} style={styles.mergeRow} onPress={() => void mergeWith(o)} accessibilityRole="button">
                  <FaceThumb faceId={o.coverFaceId} size={44} />
                  <Text style={styles.mergeName} numberOfLines={1}>
                    {o.name ?? 'Unnamed'}
                  </Text>
                  <Text style={styles.meta}>{photoCount(o.photos)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: '700' },
  top: { alignItems: 'center', paddingVertical: 16, gap: 10 },
  sub: { color: '#86868B', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 36, borderRadius: 980, backgroundColor: '#1C1C1E' },
  actionPrimary: { backgroundColor: colors.action },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { color: '#86868B', fontSize: 14, lineHeight: 20, padding: 32, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#1C1C1E', borderRadius: 20, padding: 20, gap: 14, width: '100%', maxWidth: 420, alignSelf: 'center' },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sheetHint: { color: '#86868B', fontSize: 13, marginTop: -8 },
  input: { height: 46, borderRadius: 12, backgroundColor: '#2C2C2E', color: '#fff', fontSize: 16, paddingHorizontal: 14 },
  sheetButtons: { flexDirection: 'row', gap: 12 },
  sheetButton: { flex: 1, minHeight: 46, borderRadius: 980, alignItems: 'center', justifyContent: 'center' },
  sheetButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  mergeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  mergeName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  meta: { color: '#86868B', fontSize: 12 },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginHorizontal: 16, alignSelf: 'stretch', backgroundColor: colors.action, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
  suggestText: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
});
