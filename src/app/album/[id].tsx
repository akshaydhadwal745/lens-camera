// One album: yours (share, rename, remove items, delete: the photos stay in the
// roll) or one a friend shared with you (its items, Leave). Event albums
// (docs/design/switch-features.md §3): the owner shows a QR / link; everyone in
// it adds their own photos, and the album refreshes while it's open.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaTile } from '@/components/MediaTile';
import { RollPicker } from '@/components/RollPicker';
import { Text, TextInput } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { refreshShared, selectGallery, selectShared, useStore } from '@/lib/store';
import { palette } from '@/lib/theme';
import type { GalleryItem } from '@/lib/types';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';
import { who } from '@/lib/names';

const GAP = 3;

export default function AlbumScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string; owner?: string; name?: string; ownerName?: string; event?: string }>();
  const sharedWithMe = !!params.owner;
  const gallery = useStore(selectGallery);
  const shared = useStore(selectShared);
  const myId = useStore((s) => s.identity?.id);
  const [event, setEvent] = useState<{ code: string; url: string } | null>(null);
  const [picking, setPicking] = useState(false);
  // An event album: mine with the link on, or one I joined by link (I can add my photos).
  const isEvent = sharedWithMe ? params.event === '1' : !!event;

  const [name, setName] = useState(params.name ?? '');
  const [ids, setIds] = useState<string[] | null>(null);
  const [members, setMembers] = useState<{ id: string; name?: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selecting = selected.size > 0;

  const load = useCallback(() => {
    if (sharedWithMe) {
      void refreshShared();
      // Event album: which of its photos are mine (others' come through the Shared list).
      if (isEvent) api.mySharedAlbumItems(params.owner!, params.id).then((r) => setIds(r.mine), () => {});
      return;
    }
    void refreshShared(); // others' photos in my event album arrive through the Shared list
    api.album(params.id).then(
      (r) => {
        setName(r.album.name);
        setIds(r.items.map((m) => m.id));
        setMembers(r.members);
        setEvent(r.album.event ?? null);
      },
      (error) => {
        setIds([]);
        notify('Could not load the album', errorMessage(error));
      },
    );
  }, [params.id, params.owner, sharedWithMe, isEvent]);

  useFocusEffect(load);

  // Event albums fill up from everyone's phones: look again every 15 s while this screen is open.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    if (!isEvent || !focused) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [isEvent, focused, load]);

  // Own album: the roll's items (local files, upload state) in the album's order. Shared: the Shared list's items of this album.
  const items = useMemo<GalleryItem[] | null>(() => {
    // Shared: this album's items from everyone (event albums hold several people's photos), plus my own in it.
    if (sharedWithMe) {
      const theirs = shared.filter((g) => g.albumId === params.id && (g.albumOwnerId ?? g.ownerId) === params.owner);
      if (!isEvent || !ids) return theirs;
      const mine = new Map(gallery.map((g) => [g.id, g]));
      return [...theirs, ...ids.map((id) => mine.get(id)).filter((g): g is GalleryItem => !!g)].sort((a, b) => b.createdAt - a.createdAt);
    }
    if (!ids) return null;
    // Mine: my photos from the roll, and people's photos in my event album from the Shared list.
    const byId = new Map(gallery.map((g) => [g.id, g]));
    for (const g of shared) if (g.albumId === params.id && g.albumOwnerId === myId && !byId.has(g.id)) byId.set(g.id, g);
    return ids.map((id) => byId.get(id)).filter((g): g is GalleryItem => !!g);
  }, [sharedWithMe, shared, gallery, ids, params.id, params.owner, isEvent, myId]);

  const content = Math.min(width, 900);
  const cols = content >= 700 ? 5 : 3;
  const tile = Math.floor((content - (cols - 1) * GAP) / cols);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onPress = (item: GalleryItem) => {
    if (selecting) return toggle(item.id);
    router.push({ pathname: '/viewer/[id]', params: { id: item.id, source: item.ownerId ? 'shared' : 'mine' } });
  };

  // What I may take out: anything in my album; in someone's event album, only my own photos.
  const canRemove = (g: GalleryItem) => !sharedWithMe || (isEvent && !g.ownerId);

  const startEvent = async () => {
    const ok = await confirmDestructive(
      'Invite with a QR code?',
      'Anyone with the link or QR code can see this album and add their photos. You can turn the link off any time; you can remove any photo.',
      'Make QR code',
    );
    if (!ok) return;
    await run(async () => {
      const r = await api.setEvent(params.id, true);
      if (r.event) {
        setEvent(r.event);
        router.push({ pathname: '/event-code', params: { album: params.id, name, url: r.event.url } });
      }
    }, 'Could not make the link');
  };

  const addMine = async (chosen: string[]) => {
    if (sharedWithMe) await api.addToSharedAlbum(params.owner!, params.id, chosen);
    else await api.editAlbum(params.id, { add: chosen });
    load();
    notify('Added', `${chosen.length} ${chosen.length === 1 ? 'item' : 'items'} in “${name}”. Everyone in the album can see ${chosen.length === 1 ? 'it' : 'them'}.`);
  };

  const run = async (work: () => Promise<void>, failed: string) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      notify(failed, errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = () =>
    run(async () => {
      if (sharedWithMe) {
        for (const id of selected) await api.removeFromSharedAlbum(params.owner!, params.id, id);
      } else {
        await api.editAlbum(params.id, { remove: [...selected] });
      }
      setSelected(new Set());
      load();
    }, 'Could not remove them');

  const rename = () =>
    run(async () => {
      const next = (renaming ?? '').trim();
      if (!next) return;
      await api.renameAlbum(params.id, next);
      setName(next);
      setRenaming(null);
    }, 'Could not rename the album');

  const remove = async () => {
    const ok = await confirmDestructive(
      sharedWithMe ? `Leave “${name}”?` : `Delete the album “${name}”?`,
      sharedWithMe
        ? isEvent
          ? 'Its photos leave your Shared tab, and the photos you added leave the album.'
          : `Its photos leave your Shared tab. ${params.ownerName ?? 'The owner'} can share it with you again.`
        : `Your photos stay in the roll.${members.length ? ` ${members.length} ${members.length === 1 ? 'person loses' : 'people lose'} access to this album.` : ''}`,
      sharedWithMe ? 'Leave' : 'Delete album',
    );
    if (!ok) return;
    await run(async () => {
      if (sharedWithMe) await api.leaveAlbum(params.owner!, params.id);
      else await api.deleteAlbum(params.id);
      if (sharedWithMe) await refreshShared();
      router.back();
    }, 'Could not do that');
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => (selecting ? setSelected(new Set()) : router.back())} hitSlop={10} style={styles.headerButton} accessibilityLabel={selecting ? 'Cancel selection' : 'Back'}>
          <Ionicons name={selecting ? 'close' : 'chevron-back'} size={26} color={colors.link} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.title} numberOfLines={1}>
            {selecting ? `${selected.size} selected` : name || 'Album'}
          </Text>
          {!selecting ? (
            <Text style={styles.sub} numberOfLines={1}>
              {sharedWithMe
                ? `${isEvent ? 'Event by' : 'Shared by'} ${params.ownerName ?? 'a friend'}`
                : members.length
                  ? `Shared with ${members.map((m) => who(m)).join(', ')}`
                  : `${items?.length ?? 0} item${items?.length === 1 ? '' : 's'}`}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerButton}>{busy ? <ActivityIndicator color={colors.link} /> : null}</View>
      </View>

      {!selecting ? (
        <View style={styles.actions}>
          {!sharedWithMe ? (
            <>
              <Pressable style={[styles.action, styles.actionPrimary]} disabled={!items?.length} onPress={() => router.push({ pathname: '/share', params: { album: params.id, albumName: name, albumCount: String(items?.length ?? 0) } })}>
                <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                <Text style={styles.actionPrimaryText}>Share album</Text>
              </Pressable>
              <Pressable
                style={styles.action}
                onPress={() =>
                  event ? router.push({ pathname: '/event-code', params: { album: params.id, name, url: event.url } }) : void startEvent()
                }
              >
                <Ionicons name="qr-code-outline" size={16} color="#fff" />
                <Text style={styles.actionText}>{event ? 'Event QR' : 'Invite with QR'}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => setRenaming(name)}>
                <Text style={styles.actionText}>Rename</Text>
              </Pressable>
            </>
          ) : null}
          {isEvent || !sharedWithMe ? (
            <Pressable style={styles.action} onPress={() => setPicking(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.actionText}>Add photos</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.action} onPress={() => void remove()}>
            <Text style={[styles.actionText, { color: palette.danger }]}>{sharedWithMe ? 'Leave' : 'Delete'}</Text>
          </Pressable>
        </View>
      ) : null}

      {items === null ? (
        <ActivityIndicator color={palette.text} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          key={cols}
          numColumns={cols}
          keyExtractor={(g) => `${g.ownerId ?? 'me'}-${g.id}`}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + 100, width: content, alignSelf: 'center' }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {sharedWithMe ? 'Nothing in this album right now.' : 'This album is empty. In the roll, hold a photo, pick more, then “Add to album”.'}
            </Text>
          }
          renderItem={({ item }) => (
            <MediaTile item={item} size={tile} selecting={selecting} selected={selected.has(item.id)} onPress={onPress} onLongPress={(g) => canRemove(g) && toggle(g.id)} />
          )}
        />
      )}

      {selecting && (!sharedWithMe || isEvent) ? (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 10 }]}>
          <Pressable style={styles.barButton} onPress={() => void removeSelected()} disabled={busy}>
            <Ionicons name="remove-circle-outline" size={22} color={palette.text} />
            <Text style={styles.barText}>Remove from album</Text>
          </Pressable>
        </View>
      ) : null}

      <RollPicker
        visible={picking}
        exclude={new Set(items?.map((g) => g.id) ?? [])}
        title={`Add to “${name || 'album'}”`}
        onClose={() => setPicking(false)}
        onPick={addMine}
      />

      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRenaming(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Rename album</Text>
            <TextInput value={renaming ?? ''} onChangeText={setRenaming} style={styles.input} maxLength={60} autoFocus returnKeyType="done" onSubmitEditing={() => void rename()} />
            <View style={styles.sheetButtons}>
              <Pressable style={[styles.sheetButton, { backgroundColor: '#2C2C2E' }]} onPress={() => setRenaming(null)}>
                <Text style={styles.sheetButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.sheetButton, { backgroundColor: colors.action }]} onPress={() => void rename()} disabled={busy}>
                <Text style={styles.sheetButtonText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 52 },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  sub: { color: '#86868B', fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, flexWrap: 'wrap' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 980, backgroundColor: '#1C1C1E' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  actionPrimary: { backgroundColor: colors.action },
  actionPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { color: '#86868B', fontSize: 14, lineHeight: 20, padding: 32, textAlign: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(18,18,18,0.96)', paddingTop: 10, alignItems: 'center' },
  barButton: { alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingVertical: 6 },
  barText: { color: '#fff', fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#1C1C1E', borderRadius: 20, padding: 20, gap: 14, width: '100%', maxWidth: 420, alignSelf: 'center' },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  input: { height: 46, borderRadius: 12, backgroundColor: '#2C2C2E', color: '#fff', fontSize: 16, paddingHorizontal: 14 },
  sheetButtons: { flexDirection: 'row', gap: 12 },
  sheetButton: { flex: 1, minHeight: 46, borderRadius: 980, alignItems: 'center', justifyContent: 'center' },
  sheetButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
