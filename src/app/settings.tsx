import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, WEB_URL } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import {
  CELLULAR_OPTIONS,
  freeUpSpace,
  RETENTION_OPTIONS,
  retryFailed,
  selectFailedCount,
  selectLocalUsage,
  selectPendingCount,
  selectWaitingForWifi,
  setCellularUploads,
  setRetention,
  unlinkBrowser,
  useStore,
} from '@/lib/store';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

const isWeb = Platform.OS === 'web';
const mark = require('../../assets/splash-icon.png');

function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function LinkBrowser() {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  const remaining = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;

  const create = async () => {
    setLoading(true);
    try {
      setPairing(await api.createPairing());
      setNow(Date.now());
    } catch (error) {
      notify('Could not create a code', errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  if (pairing && remaining > 0) {
    const pretty = `${pairing.code.slice(0, 4)}-${pairing.code.slice(4)}`;
    return (
      <View style={{ padding: 16, alignItems: 'center' }}>
        <Text style={styles.muted}>On your computer, open</Text>
        <Pressable onPress={() => Clipboard.setStringAsync(`${WEB_URL}/link`)}>
          <Text style={styles.link}>{WEB_URL.replace('https://', '')}/link</Text>
        </Pressable>
        <Text style={[styles.muted, { marginTop: 12 }]}>and enter</Text>
        <Text style={styles.code} selectable>
          {pretty}
        </Text>
        <Text style={styles.muted}>
          Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
        </Text>
      </View>
    );
  }

  return (
    <Pressable style={styles.button} onPress={create} disabled={loading}>
      {loading ? <ActivityIndicator color="#000" /> : <Ionicons name="desktop-outline" size={18} color="#000" />}
      <Text style={styles.buttonText}>Link a browser</Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const identity = useStore((s) => s.identity);
  const usage = useStore((s) => s.usage);
  const online = useStore((s) => s.online);
  const retentionDays = useStore((s) => s.settings.retentionDays);
  const local = useStore(selectLocalUsage);
  const pending = useStore(selectPendingCount);
  const failed = useStore(selectFailedCount);
  const waitingForWifi = useStore(selectWaitingForWifi);
  const cellularPolicy = useStore((s) => s.settings.cellularUploads);
  const cellular = useStore((s) => s.cellular);

  const usedPct = usage ? Math.min(1, usage.usedBytes / usage.quotaBytes) : 0;

  const onFreeUp = async () => {
    if (!local.freeableCount) return;
    const ok = await confirmDestructive(
      'Free up space?',
      `Removes ${local.freeableCount} item${local.freeableCount === 1 ? '' : 's'} (${formatBytes(local.freeable)}) from this device. They stay safe in the cloud.`,
      'Free up',
    );
    if (!ok) return;
    const result = freeUpSpace();
    notify('Done', `Freed ${formatBytes(result.bytes)}.`);
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{isWeb ? 'Account' : 'Settings'}</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <View style={styles.identity}>
          <Image source={mark} style={{ width: 72, height: 72 }} contentFit="contain" />
          {identity ? (
            <>
              <Text style={styles.muted}>You are</Text>
              <Pressable
                onPress={() => Clipboard.setStringAsync(identity.name).then(() => notify('Name copied'))}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Text style={styles.name}>{identity.name}</Text>
                <Ionicons name="copy-outline" size={16} color={colors.muted} />
              </Pressable>
              <Text style={[styles.muted, { textAlign: 'center' }]}>Friends can find you by this name to send you photos.</Text>
            </>
          ) : (
            <Text style={styles.muted}>{online ? 'Setting up your cloud identity…' : 'Connect to the internet to set up your cloud identity.'}</Text>
          )}
        </View>

        <Section title="Cloud storage">
          <View style={{ padding: 16 }}>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${usedPct * 100}%` }]} />
            </View>
            <Text style={[styles.muted, { marginTop: 8 }]}>
              {usage ? `${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)} used` : 'Loading…'}
            </Text>
          </View>
        </Section>

        {!isWeb && (
          <>
            <Section
              title="On this device"
              footer="Every shot uploads to the cloud right away. A local copy is kept for quick viewing and removed automatically after this time, but only once it's safely in the cloud."
            >
              <Row label="Stored here" value={`${local.count} items · ${formatBytes(local.bytes)}`} />
              <View style={styles.divider} />
              <Text style={[styles.rowLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>Keep local copies for</Text>
              <View style={styles.chips}>
                {RETENTION_OPTIONS.map((o) => (
                  <Pressable
                    key={o.days}
                    onPress={() => setRetention(o.days)}
                    style={[styles.chip, retentionDays === o.days && styles.chipOn]}
                    accessibilityState={{ selected: retentionDays === o.days }}
                  >
                    <Text style={[styles.chipText, retentionDays === o.days && styles.chipTextOn]}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.divider} />
              <Pressable style={styles.rowButton} onPress={onFreeUp} disabled={!local.freeableCount}>
                <Ionicons name="trash-bin-outline" size={18} color={local.freeableCount ? colors.accent : '#555'} />
                <Text style={[styles.rowButtonText, !local.freeableCount && { color: '#555' }]}>
                  Free up space now{local.freeableCount ? ` (${formatBytes(local.freeable)})` : ''}
                </Text>
              </Pressable>
            </Section>

            <Section
              title="Uploads"
              footer="Originals always upload at full quality, never compressed. On mobile data you can hold back big files (usually videos) until you're on Wi-Fi."
            >
              <Row label="Connection" value={!online ? 'Offline' : cellular ? 'Mobile data' : 'Wi-Fi'} />
              <View style={styles.divider} />
              <Row label="Waiting" value={waitingForWifi ? `${pending} (${waitingForWifi} for Wi-Fi)` : String(pending)} />
              <View style={styles.divider} />
              <Text style={[styles.rowLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>Upload over mobile data</Text>
              <View style={styles.chips}>
                {CELLULAR_OPTIONS.map((o) => (
                  <Pressable
                    key={o.value}
                    onPress={() => setCellularUploads(o.value)}
                    style={[styles.chip, cellularPolicy === o.value && styles.chipOn]}
                    accessibilityState={{ selected: cellularPolicy === o.value }}
                  >
                    <Text style={[styles.chipText, cellularPolicy === o.value && styles.chipTextOn]}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
              {failed > 0 && (
                <>
                  <View style={styles.divider} />
                  <Pressable style={styles.rowButton} onPress={retryFailed}>
                    <Ionicons name="refresh" size={18} color={colors.danger} />
                    <Text style={[styles.rowButtonText, { color: colors.danger }]}>Retry {failed} failed</Text>
                  </Pressable>
                </>
              )}
            </Section>

            <Section title="Web viewer" footer="Watch your photos and videos on any computer. Codes work once and expire after 5 minutes.">
              {identity ? <LinkBrowser /> : <Text style={[styles.muted, { padding: 16 }]}>Available once you're online.</Text>}
            </Section>
          </>
        )}

        {isWeb && (
          <Section title="This browser">
            <Pressable
              style={styles.rowButton}
              onPress={async () => {
                if (await confirmDestructive('Sign out?', 'You can link this browser again with a new code.', 'Sign out')) {
                  await unlinkBrowser();
                  router.replace('/link');
                }
              }}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.danger} />
              <Text style={[styles.rowButtonText, { color: colors.danger }]}>Sign out of this browser</Text>
            </Pressable>
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0B0B0D' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  done: { color: colors.accent, fontSize: 17, fontWeight: '600' },
  identity: { alignItems: 'center', gap: 6, paddingVertical: 20, paddingHorizontal: 24 },
  name: { color: '#fff', fontSize: 24, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 14 },
  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: '#1C1C1E', borderRadius: 14, overflow: 'hidden' },
  footer: { color: '#777', fontSize: 12, marginTop: 8, marginHorizontal: 4, lineHeight: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, minHeight: 48 },
  rowLabel: { color: '#fff', fontSize: 15 },
  rowValue: { color: colors.muted, fontSize: 15 },
  rowButton: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 48 },
  rowButtonText: { color: colors.accent, fontSize: 15, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#333', marginLeft: 16 },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#333', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.brand },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16, paddingTop: 10 },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#2C2C2E' },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  chipTextOn: { color: '#000', fontWeight: '700' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    margin: 16,
    borderRadius: 12,
    minHeight: 46,
  },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 15 },
  link: { color: '#60A5FA', fontSize: 16, fontWeight: '600', marginTop: 4 },
  code: { color: '#fff', fontSize: 36, fontWeight: '800', letterSpacing: 4, marginVertical: 8, fontVariant: ['tabular-nums'] },
});
