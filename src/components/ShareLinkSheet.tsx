// Share by link (docs/features/share-links.md): for people without Lens. The
// sender reviews exactly which items go in (never an album or the library),
// picks who may open it and for how long, then copies it or sends it with any
// app. Turn links off in Settings → Sharing → Share links.
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { api, ShareLink } from '@/lib/api';
import { selectGallery, useStore } from '@/lib/store';
import { palette, radius } from '@/lib/theme';
import { colors, errorMessage, notify } from '@/lib/ui';
import { displayUri } from '@/lib/types';

export const MAX_LINK_ITEMS = 20;
type Expiry = '1d' | '7d' | '30d';
const EXPIRY: { value: Expiry; label: string }[] = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[styles.segment, o.value === value && styles.segmentOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
        >
          <Text style={[styles.segmentText, o.value === value && styles.segmentTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ShareLinkSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const gallery = useStore(selectGallery);
  const items = useMemo(() => ids.map((id) => gallery.find((g) => g.id === id)).filter((g) => !!g), [ids, gallery]);
  const notReady = items.filter((g) => g.sync !== 'synced').length;
  const [mode, setMode] = useState<'anyone' | 'one'>('anyone');
  const [expires, setExpires] = useState<Expiry>('7d');
  const [includeLocation, setIncludeLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<ShareLink | null>(null);
  const photos = items.filter((g) => g.kind !== 'video').length;
  const videos = items.length - photos;
  const what = [photos ? `${photos} photo${photos === 1 ? '' : 's'}` : '', videos ? `${videos} video${videos === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  const tooMany = items.length > MAX_LINK_ITEMS;

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createLink(ids, expires, mode, includeLocation);
      setLink(r.link);
    } catch (error) {
      notify('Could not make a link', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const message = link ? `I shared ${what} with you on Lens: ${link.url}` : '';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{link ? 'Your link is ready' : `Share ${what} by link`}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={palette.muted} />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
            {items.map((g) => (
              <View key={g.id} style={styles.thumb}>
                <Image source={{ uri: displayUri(g) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                {g.kind === 'video' ? <Ionicons name="play" size={16} color="#fff" style={styles.play} /> : null}
              </View>
            ))}
          </ScrollView>
          <Text style={styles.note}>Only these {items.length === 1 ? 'one item' : `${items.length} items`}. Not your albums or the rest of your library.</Text>

          {link ? (
            <>
              <View style={styles.linkBox}>
                <Text style={styles.linkText} selectable numberOfLines={1}>
                  {link.url}
                </Text>
              </View>
              <Text style={styles.note}>
                {link.mode === 'one' ? 'Only the first person who opens it in Lens gets it. ' : 'Anyone with the link can see these. '}
                Works for {EXPIRY.find((e) => e.value === expires)?.label}. Turn it off any time in Settings → Sharing → Share links.
              </Text>
              <View style={styles.buttons}>
                <Pressable
                  style={[styles.button, styles.secondary]}
                  onPress={() => void Clipboard.setStringAsync(link.url).then(() => notify('Link copied', 'Paste it in WhatsApp or any app.'))}
                  accessibilityRole="button"
                >
                  <Text style={styles.buttonText}>Copy</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.primary]} onPress={() => void Share.share({ message })} accessibilityRole="button">
                  <Text style={styles.buttonText}>Send…</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Who can open it</Text>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'anyone', label: 'Anyone with the link' },
                  { value: 'one', label: 'Only one person' },
                ]}
              />
              <Text style={styles.hint}>
                {mode === 'anyone'
                  ? 'They see the photos in their browser, or in Lens once they get it.'
                  : 'The web page shows nothing; the first person who opens it in Lens gets the photos and nobody else can after that.'}
              </Text>
              <Text style={styles.label}>Link works for</Text>
              <Segmented value={expires} onChange={setExpires} options={EXPIRY} />
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={18} color={palette.dim} />
                <Text style={[styles.hint, { flex: 1, marginTop: 0 }]}>Include where they were taken</Text>
                <Switch value={includeLocation} onValueChange={setIncludeLocation} />
              </View>
              {tooMany || notReady ? (
                <Text style={[styles.hint, { color: palette.danger }]}>
                  {tooMany ? `A link holds up to ${MAX_LINK_ITEMS} items. Pick fewer.` : 'Some items are still uploading. Make the link when they’re in the cloud.'}
                </Text>
              ) : null}
              <Pressable
                style={[styles.button, styles.primary, styles.wide, (busy || tooMany || !!notReady) && { opacity: 0.5 }]}
                onPress={() => void create()}
                disabled={busy || tooMany || !!notReady}
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create link</Text>}
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 20, paddingTop: 20, maxWidth: 640, width: '100%', alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: palette.text, fontSize: 19, fontWeight: '700', flex: 1 },
  thumbs: { gap: 6, paddingVertical: 14 },
  thumb: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.surface2 },
  play: { position: 'absolute', right: 4, bottom: 4 },
  note: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  label: { color: palette.text, fontSize: 15, fontWeight: '600', marginTop: 18, marginBottom: 8 },
  hint: { color: palette.muted, fontSize: 13, lineHeight: 18, marginTop: 8 },
  segmented: { flexDirection: 'row', backgroundColor: palette.surface2, borderRadius: radius.pill, padding: 3 },
  segment: { flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segmentOn: { backgroundColor: palette.surface3 },
  segmentText: { color: palette.muted, fontSize: 13, fontWeight: '600' },
  segmentTextOn: { color: palette.text },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  linkBox: { backgroundColor: palette.surface2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginTop: 14, marginBottom: 8 },
  linkText: { color: colors.link, fontSize: 15 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  button: { flex: 1, minHeight: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  wide: { flex: 0, marginTop: 18 },
  primary: { backgroundColor: colors.action },
  secondary: { backgroundColor: palette.surface2 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
