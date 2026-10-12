// "Add to album": pick one of your albums or make a new one.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/Text';
import { Album, api } from '@/lib/api';
import { colors, errorMessage, notify } from '@/lib/ui';

type Props = {
  visible: boolean;
  /** How many items will be added (shown in the title). */
  count: number;
  onClose: () => void;
  /** Resolves when the items are in the album. */
  onPick: (album: { id: string; name: string } | { newName: string }) => Promise<void>;
};

export function AlbumPicker({ visible, count, onClose, onPick }: Props) {
  const insets = useSafeAreaInsets();
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    api.albums().then(
      (r) => setAlbums(r.albums),
      () => setAlbums([]),
    );
  }, [visible]);

  const pick = async (choice: { id: string; name: string } | { newName: string }) => {
    setBusy(true);
    try {
      await onPick(choice);
      setName('');
      onClose();
    } catch (error) {
      notify('Could not add to the album', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <Text style={styles.title}>{count > 0 ? `Add ${count} item${count === 1 ? '' : 's'} to an album` : 'New album'}</Text>
          <View style={styles.newRow}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="New album name"
              placeholderTextColor="#636366"
              style={styles.input}
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={() => name.trim() && void pick({ newName: name.trim() })}
            />
            <Pressable style={[styles.create, !name.trim() && { opacity: 0.4 }]} disabled={!name.trim() || busy} onPress={() => void pick({ newName: name.trim() })}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.createText}>Create</Text>}
            </Pressable>
          </View>
          {count === 0 ? null : albums === null ? (
            <ActivityIndicator color="#fff" style={{ marginVertical: 20 }} />
          ) : (
            <FlatList
              data={albums}
              keyExtractor={(a) => a.id}
              style={{ maxHeight: 320 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>No albums yet. Name your first one above.</Text>}
              renderItem={({ item }) => (
                <Pressable style={styles.row} disabled={busy} onPress={() => void pick({ id: item.id, name: item.name })}>
                  <Ionicons name="albums-outline" size={20} color="#86868B" />
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowCount}>{item.count}</Text>
                </Pressable>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1C1C1E', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12, width: '100%', maxWidth: 560, alignSelf: 'center' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  newRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, height: 46, borderRadius: 12, backgroundColor: '#2C2C2E', color: '#fff', fontSize: 16, paddingHorizontal: 14 },
  create: { height: 46, paddingHorizontal: 18, borderRadius: 980, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center', minWidth: 84 },
  createText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2C2C2E' },
  rowName: { flex: 1, color: '#fff', fontSize: 16 },
  rowCount: { color: '#86868B', fontSize: 14 },
  empty: { color: '#86868B', fontSize: 14, paddingVertical: 16 },
});
