import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';

import { formatBytes } from '@/lib/format';
import { liveUploadBlocker, useStore } from '@/lib/store';

/**
 * Next to the recording timer: how much of the video is already in the cloud
 * ("64 MB of 210 MB in cloud"), or why it will upload after you stop.
 * `liveId` is the id of the upload started with the recording (null = none).
 */
export function LiveUploadPill({ liveId }: { liveId: string | null }) {
  const transfer = useStore((s) => (liveId ? s.transfers[liveId] : undefined));
  const blocker = useStore((s) => (liveId ? null : liveUploadBlocker(s)));
  const text = liveId
    ? transfer
      ? `${formatBytes(transfer.sent)} of ${formatBytes(transfer.total)} in cloud`
      : 'Uploading while recording'
    : blocker;
  if (!text) return null;
  return (
    <View style={styles.pill} accessibilityLabel={`Upload: ${text}`}>
      <Ionicons name={liveId ? 'cloud-upload' : 'cloud-outline'} size={13} color={liveId ? '#2997FF' : '#E8E8ED'} />
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    flexShrink: 1,
  },
  text: { color: '#fff', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'], flexShrink: 1 },
});
