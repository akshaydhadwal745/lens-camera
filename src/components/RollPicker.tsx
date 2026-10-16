// Pick photos/videos from your own roll (only ones already in the cloud: an
// album holds cloud items). Used by "Add photos" in albums and event albums.
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaTile } from '@/components/MediaTile';
import { Text } from '@/components/ui/Text';
import { selectGallery, useStore } from '@/lib/store';
import type { GalleryItem } from '@/lib/types';
import { colors, errorMessage, notify } from '@/lib/ui';

const GAP = 3;
const MAX = 100;

type Props = {
  visible: boolean;
  title: string;
  /** Already in the album: not offered again. */
  exclude: Set<string>;
  onClose: () => void;
  /** Resolves when they're added. */
  onPick: (ids: string[]) => Promise<void>;
  /** Most items in one pick (a share request takes 50). */
  max?: number;
};

export function RollPicker({ visible, title, exclude, onClose, onPick, max = MAX }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gallery = useStore(selectGallery);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Mine, in the cloud, not in the album yet. Still-uploading items are shown greyed (and explained).
  const items = useMemo(() => gallery.filter((g) => !g.ownerId && !exclude.has(g.id)), [gallery, exclude]);
  const cols = width >= 700 ? 6 : 4;
  const content = Math.min(width, 900);
  const tile = Math.floor((content - (cols - 1) * GAP) / cols);

  const toggle = (g: GalleryItem) => {
    if (g.sync !== 'synced') {
      notify('Still uploading', 'You can add it as soon as it’s in the cloud.');
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(g.id)) next.delete(g.id);
      else if (next.size < max) next.add(g.id);
      return next;
    });
  };

  const close = () => {
    setSelected(new Set());
    onClose();
  };

  const add = async () => {
    setBusy(true);
    try {
      await onPick([...selected]);
      close();
    } catch (error) {
      notify('Could not add them', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
        <View style={styles.header}>
          <Pressable onPress={close} hitSlop={10} style={styles.headerButton} accessibilityLabel="Cancel">
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {selected.size ? `${selected.size} selected` : title}
          </Text>
          <View style={styles.headerButton} />
        </View>
        <FlatList
          data={items}
          numColumns={cols}
          key={cols}
          keyExtractor={(g) => g.id}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + 100, width: content, alignSelf: 'center' }}
          ListEmptyComponent={<Text style={styles.empty}>Nothing to add: everything of yours is already here, or still uploading.</Text>}
          renderItem={({ item }) => (
            <View style={item.sync !== 'synced' ? { opacity: 0.4 } : undefined}>
              <MediaTile item={item} size={tile} selecting selected={selected.has(item.id)} onPress={toggle} onLongPress={toggle} />
            </View>
          )}
        />
        <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable style={[styles.add, (!selected.size || busy) && { opacity: 0.4 }]} disabled={!selected.size || busy} onPress={() => void add()}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addText}>{selected.size ? `Add ${selected.size}` : 'Choose photos'}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 64, justifyContent: 'center' },
  cancel: { color: colors.link, fontSize: 17 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  empty: { color: '#86868B', fontSize: 14, lineHeight: 20, padding: 32, textAlign: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.92)' },
  add: { minHeight: 50, borderRadius: 980, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  addText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
