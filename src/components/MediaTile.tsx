import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/lib/format';
import { useStore } from '@/lib/store';
import { displayUri, GalleryItem } from '@/lib/types';

type Props = {
  item: GalleryItem;
  size: number;
  selecting: boolean;
  selected: boolean;
  showOwner?: boolean;
  onPress: (item: GalleryItem) => void;
  onLongPress: (item: GalleryItem) => void;
};

/** Share of the original already in the cloud (null when nothing is uploading). */
function useUploadFraction(id: string): number | null {
  return useStore((s) => {
    const t = s.transfers[id];
    if (t) return t.total ? Math.round((t.sent / t.total) * 100) / 100 : 0;
    return s.uploadingId === id ? Math.round(s.progress * 100) / 100 : null;
  });
}

function UploadBar({ id }: { id: string }) {
  const fraction = useUploadFraction(id);
  if (fraction == null) return null;
  return (
    <View pointerEvents="none" style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.round(fraction * 100)}%` }]} />
    </View>
  );
}

function SyncBadge({ item }: { item: GalleryItem }) {
  const progress = useUploadFraction(item.id);
  if (item.sync === 'partial') {
    // Visible everywhere already; the full-quality original is still on its way.
    return (
      <View style={[styles.badge, styles.badgeQuiet]}>
        <Ionicons name="cloud-upload-outline" size={12} color="#93C5FD" />
      </View>
    );
  }
  if (item.sync === 'synced') {
    // Synced items that are cloud-only get a subtle cloud mark.
    return item.localUri ? null : (
      <View style={[styles.badge, styles.badgeQuiet]}>
        <Ionicons name="cloud-done-outline" size={12} color="#fff" />
      </View>
    );
  }
  if (item.sync === 'failed') {
    return (
      <View style={[styles.badge, { backgroundColor: '#DC2626' }]}>
        <Ionicons name="alert" size={12} color="#fff" />
      </View>
    );
  }
  if (item.sync === 'uploading') {
    return (
      <View style={[styles.badge, { backgroundColor: '#2563EB' }]}>
        <Text style={styles.badgeText}>{Math.round((progress ?? 0) * 100)}%</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.badgeQuiet]}>
      <Ionicons name="cloud-upload-outline" size={12} color="#fff" />
    </View>
  );
}

export const MediaTile = memo(function MediaTile({ item, size, selecting, selected, showOwner, onPress, onLongPress }: Props) {
  const uri = displayUri(item);
  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.kind === 'video' ? 'Video' : 'Photo'}${item.ownerName ? ` from ${item.ownerName}` : ''}`}
      accessibilityState={{ selected }}
      style={{ width: size, height: size }}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.image} contentFit="cover" transition={150} recyclingKey={item.id} cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.image, styles.videoTile]}>
          <Ionicons name={item.kind === 'video' ? 'play-circle' : 'image-outline'} size={36} color="rgba(255,255,255,0.85)" />
        </View>
      )}
      {uri && item.kind === 'video' && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.playOverlay]}>
          <Ionicons name="play" size={26} color="rgba(255,255,255,0.9)" />
        </View>
      )}

      {item.kind === 'video' && item.duration != null && <Text style={styles.duration}>{formatDuration(item.duration)}</Text>}
      {showOwner && item.ownerName && (
        <Text style={styles.owner} numberOfLines={1}>
          {item.ownerName}
        </Text>
      )}
      {!showOwner && <SyncBadge item={item} />}
      {!showOwner && item.sync === 'uploading' && <UploadBar id={item.id} />}

      {selecting && (
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected && <Ionicons name="checkmark" size={16} color="#000" />}
        </View>
      )}
      {selected && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.selectedOverlay]} />}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%', backgroundColor: '#111' },
  videoTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1c1c1e' },
  playOverlay: { alignItems: 'center', justifyContent: 'center' },
  duration: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
  owner: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 5,
    paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  badge: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(0,0,0,0.5)' },
  barFill: { height: '100%', backgroundColor: '#3B82F6' },
  badgeQuiet: { backgroundColor: 'rgba(0,0,0,0.55)' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  check: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  checkOn: { backgroundColor: '#FACC15', borderColor: '#FACC15' },
  selectedOverlay: { backgroundColor: 'rgba(255,255,255,0.2)' },
});
