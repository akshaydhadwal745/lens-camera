import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isProCameraAvailable } from '../../modules/lens-camera';

import { api, Session, WEB_URL } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import {
  CELLULAR_OPTIONS,
  freeUpSpace,
  guardSpace,
  logOut,
  KEEP_FREE_OPTIONS,
  RETENTION_OPTIONS,
  retryFailed,
  selectFailedCount,
  selectLocalUsage,
  selectPendingCount,
  selectWaitingForWifi,
  setCellularUploads,
  setKeepFree,
  setLiveUpload,
  LIVE_UPLOAD_OPTIONS,
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

function timeAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 30 ? `${days} days ago` : `${Math.floor(days / 30)} months ago`;
}

/** Guest → sign-in prompt. Signed in → email, devices, log out. */
function AccountSection() {
  const email = useStore((s) => s.identity?.email);
  const signedOut = useStore((s) => s.signedOut);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!email) return;
    api
      .sessions()
      .then((r) => setSessions(r.sessions))
      .catch(() => {});
  }, [email]);

  if (signedOut || !email) {
    return (
      <Section
        title="Account"
        footer={
          signedOut
            ? 'Uploads are paused until you sign in. Nothing on this phone is lost.'
            : 'Right now your photos are tied to this phone. Sign in to get them back on a new phone or after reinstalling.'
        }
      >
        <Pressable style={styles.button} onPress={() => router.push('/signin')}>
          <Ionicons name="person-circle-outline" size={18} color="#000" />
          <Text style={styles.buttonText}>{signedOut ? 'Sign in again' : 'Sign in'}</Text>
        </Pressable>
      </Section>
    );
  }

  const others = (sessions ?? []).filter((s) => !s.current);

  const logOutOthers = async () => {
    if (!(await confirmDestructive('Log out other devices?', `${others.length} other device${others.length === 1 ? '' : 's'} will be signed out.`, 'Log out')))
      return;
    setBusy(true);
    try {
      await api.revokeOtherSessions();
      setSessions((list) => (list ?? []).filter((s) => s.current));
    } catch (error) {
      notify('Could not log out other devices', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const logOutHere = async () => {
    if (
      !(await confirmDestructive(
        'Log out of this phone?',
        'Your photos stay safe in your account. Copies on this phone are removed; sign in again to see everything.',
        'Log out',
      ))
    )
      return;
    setBusy(true);
    try {
      await logOut();
    } catch (error) {
      notify('Can’t log out yet', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Account" footer="Sign in with this email on any phone to get all your photos back.">
      <Row label="Signed in as" value={email} />
      <View style={styles.divider} />
      <Text style={[styles.rowLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>Devices</Text>
      {sessions === null ? (
        <ActivityIndicator color="#fff" style={{ padding: 12 }} />
      ) : (
        sessions.map((s) => (
          <View key={s.id} style={[styles.row, { minHeight: 44 }]}>
            <Text style={styles.rowValue}>
              {s.kind === 'web' ? '🖥  ' : '📱  '}
              {s.label}
            </Text>
            <Text style={[styles.rowValue, s.current && { color: colors.accent }]}>{s.current ? 'This phone' : timeAgo(s.lastUsedAt)}</Text>
          </View>
        ))
      )}
      {others.length > 0 && (
        <>
          <View style={styles.divider} />
          <Pressable style={styles.rowButton} onPress={logOutOthers} disabled={busy}>
            <Ionicons name="exit-outline" size={18} color={colors.accent} />
            <Text style={styles.rowButtonText}>Log out other devices</Text>
          </Pressable>
        </>
      )}
      <View style={styles.divider} />
      <Pressable style={styles.rowButton} onPress={logOutHere} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.danger} /> : <Ionicons name="log-out-outline" size={18} color={colors.danger} />}
        <Text style={[styles.rowButtonText, { color: colors.danger }]}>Log out</Text>
      </Pressable>
    </Section>
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
  const keepFreeGB = useStore((s) => s.settings.keepFreeGB);
  const freeBytes = useStore((s) => s.freeBytes);
  const local = useStore(selectLocalUsage);
  const pending = useStore(selectPendingCount);
  const failed = useStore(selectFailedCount);
  const waitingForWifi = useStore(selectWaitingForWifi);
  const cellularPolicy = useStore((s) => s.settings.cellularUploads);
  const livePolicy = useStore((s) => s.settings.liveUpload);
  const cellular = useStore((s) => s.cellular);

  const usedPct = usage ? Math.min(1, usage.usedBytes / usage.quotaBytes) : 0;

  // Fresh free-space reading (and a guardian pass) whenever Settings opens.
  useEffect(() => {
    if (!isWeb) guardSpace();
  }, []);

  const onFreeUp = async () => {
    if (!local.freeableCount) return;
    const ok = await confirmDestructive(
      'Free up space?',
      `Removes the originals of ${local.freeableCount} item${local.freeableCount === 1 ? '' : 's'} (${formatBytes(local.freeable)}) from this device. They stay safe in the cloud, and their previews stay in your gallery.`,
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

        {!isWeb && <AccountSection />}

        <Section title="Storage">
          <View style={{ padding: 16 }}>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${usedPct * 100}%` }]} />
            </View>
            <Text style={[styles.muted, { marginTop: 8 }]}>
              {usage ? `${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)} used` : 'Loading…'}
            </Text>
          </View>
          {identity && (
            <>
              <View style={styles.divider} />
              <Pressable style={styles.rowButton} onPress={() => router.push('/storage')}>
                <Ionicons name="server-outline" size={18} color={colors.accent} />
                <Text style={[styles.rowButtonText, { flex: 1 }]}>Storage: Lens & your own</Text>
                <Ionicons name="chevron-forward" size={16} color="#555" />
              </Pressable>
              <View style={styles.divider} />
              <Pressable style={styles.rowButton} onPress={() => router.push('/trash')}>
                <Ionicons name="trash-outline" size={18} color={colors.accent} />
                <Text style={[styles.rowButtonText, { flex: 1 }]}>Trash & Archive</Text>
                <Ionicons name="chevron-forward" size={16} color="#555" />
              </Pressable>
            </>
          )}
        </Section>

        {!isWeb && (
          <>
            <Section
              title="On this device"
              footer="Every shot uploads to the cloud right away. The full-size original stays on the phone for the time you choose, and sooner if the phone runs low on space (oldest first). Nothing is removed until it's safely in the cloud, and previews always stay so your gallery works offline."
            >
              <Row label="Originals here" value={`${local.count} items · ${formatBytes(local.bytes)}`} />
              {local.offloaded > 0 && (
                <>
                  <View style={styles.divider} />
                  <Row label="Preview only (in the cloud)" value={`${local.offloaded} items`} />
                </>
              )}
              {freeBytes !== null && (
                <>
                  <View style={styles.divider} />
                  <Row label="Free on this phone" value={formatBytes(freeBytes)} />
                </>
              )}
              <View style={styles.divider} />
              <Text style={[styles.rowLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>Keep originals on phone for</Text>
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
              <Text style={[styles.rowLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>Always keep free on phone</Text>
              <View style={styles.chips}>
                {KEEP_FREE_OPTIONS.map((o) => (
                  <Pressable
                    key={o.gb}
                    onPress={() => setKeepFree(o.gb)}
                    style={[styles.chip, keepFreeGB === o.gb && styles.chipOn]}
                    accessibilityState={{ selected: keepFreeGB === o.gb }}
                  >
                    <Text style={[styles.chipText, keepFreeGB === o.gb && styles.chipTextOn]}>{o.label}</Text>
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
              {Platform.OS === 'android' && isProCameraAvailable && (
                <>
                  <View style={styles.divider} />
                  <Pressable style={styles.rowButton} onPress={() => router.push('/camera-info')}>
                    <Ionicons name="hardware-chip-outline" size={18} color={colors.accent} />
                    <Text style={[styles.rowButtonText, { flex: 1 }]}>Camera info</Text>
                    <Ionicons name="chevron-forward" size={16} color="#555" />
                  </Pressable>
                </>
              )}
            </Section>

            <Section
              title="Uploads"
              footer={
                Platform.OS === 'android'
                  ? "Originals always upload at full quality, never compressed. Videos can upload while you record, so they're in the cloud seconds after you stop. On mobile data you can hold back big files until you're on Wi-Fi."
                  : "Originals always upload at full quality, never compressed. On mobile data you can hold back big files (usually videos) until you're on Wi-Fi."
              }
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
              {Platform.OS === 'android' && (
                <>
                  <View style={styles.divider} />
                  <Text style={[styles.rowLabel, { paddingHorizontal: 16, paddingTop: 12 }]}>Upload videos while recording</Text>
                  <View style={styles.chips}>
                    {LIVE_UPLOAD_OPTIONS.map((o) => (
                      <Pressable
                        key={o.value}
                        onPress={() => setLiveUpload(o.value)}
                        style={[styles.chip, livePolicy === o.value && styles.chipOn]}
                        accessibilityState={{ selected: livePolicy === o.value }}
                      >
                        <Text style={[styles.chipText, livePolicy === o.value && styles.chipTextOn]}>{o.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
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
