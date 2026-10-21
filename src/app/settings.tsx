import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Href, router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isProCameraAvailable } from '../../modules/lens-camera';

import { api, NotificationPrefs, Session, WEB_URL } from '@/lib/api';
import { buildLabel } from '@/lib/build-info';
import { diagnosticsEnabled, setDiagnosticsEnabled } from '@/lib/diagnostics';
import { backupNotificationsEnabled, setBackupNotifications } from '@/lib/local-notify';
import { setSaveLocation as setSaveLocationPref } from '@/lib/location-pref';
import { nearbySupported, nearbyVisibilityChanged } from '@/lib/nearby';
import { peopleSupported } from '@/lib/people';
import { askForNotifications } from '@/lib/push';
import { formatBytes } from '@/lib/format';
import {
  CELLULAR_OPTIONS,
  deleteAccount,
  freeUpSpace,
  canRemoveFromGallery,
  galleryCleanupCandidates,
  removeFromGallery,
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
import { loadSettings, setCameraOption } from '@/lib/pro-camera';
import { font, palette, type as typeStyle } from '@/lib/theme';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';
import { RealNameSheet } from '@/components/RealNameSheet';

const isWeb = Platform.OS === 'web';

/** "1 imported photo", "3 imported photos and 1 video". */
function describeItems(photos: number, videos: number): string {
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (!videos) return `${part(photos, 'imported photo')}`;
  if (!photos) return `${part(videos, 'imported video')}`;
  return `${part(photos, 'imported photo')} and ${part(videos, 'video')}`;
}
// Same units as everywhere else (1 GB = 1024³ bytes; quotas are set that way, so 100 GB shows as 100).
const GB = 1024 ** 3;
const formatGB = (bytes: number) => (bytes >= GB ? `${Math.round(bytes / GB)} GB` : formatBytes(bytes));

function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={18} color={palette.muted} /> : null}
      <Text style={[styles.rowLabel, icon && { flex: 1 }]}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/** An on/off option (with an icon, so it lines up with the LinkRows in the same card). */
function SwitchRow({
  icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={[styles.row, hint ? { paddingVertical: 10 } : null]}>
      <Ionicons name={icon} size={18} color={palette.muted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.switchHint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: palette.link, false: palette.surface3 }} thumbColor="#fff" />
    </View>
  );
}

/** A row that opens another screen: white label, grey value, chevron. */
function LinkRow({
  icon,
  label,
  value,
  valueColor,
  onPress,
  external,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  valueColor?: string;
  onPress: () => void;
  /** Opens the website (browser) instead of a screen. */
  external?: boolean;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.rowButton, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button">
      {icon ? <Ionicons name={icon} size={18} color={palette.muted} /> : null}
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      {value ? <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text> : null}
      <Ionicons name={external ? 'open-outline' : 'chevron-forward'} size={16} color="#636366" />
    </Pressable>
  );
}

function initials(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || 'L';
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
          <Ionicons name="person-circle-outline" size={18} color="#fff" />
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
            <Text style={[styles.rowValue, s.current && { color: palette.safe }]}>{s.current ? 'This phone' : timeAgo(s.lastUsedAt)}</Text>
          </View>
        ))
      )}
      {others.length > 0 && (
        <>
          <View style={styles.divider} />
          <Pressable style={styles.rowButton} onPress={logOutOthers} disabled={busy}>
            <Text style={styles.rowButtonText}>Log out other devices</Text>
          </Pressable>
        </>
      )}
      <View style={styles.divider} />
      <Pressable style={styles.rowButton} onPress={logOutHere} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.danger} /> : null}
        <Text style={[styles.rowButtonText, { color: colors.danger }]}>Log out</Text>
      </Pressable>
    </Section>
  );
}

/** Invite friends (+storage) and the affiliate program. (Admin lives in the Lens Console website.) */
function EarnSection({ signedIn }: { signedIn: boolean }) {
  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string; to: '/invite' | '/partners' }[] = [
    { icon: 'gift-outline', label: 'Invite friends', value: '+10 GB each', to: '/invite' },
    // Native: only an entry that opens the website, where the whole program lives (apply, dashboard, payouts).
    { icon: 'trending-up-outline', label: 'Affiliate program', value: Platform.OS === 'web' ? '50%' : undefined, to: '/partners' },
  ];
  return (
    <Section title="Invite & earn">
      {rows.map((r, i) => (
        <View key={r.to}>
          {i > 0 && <View style={styles.divider} />}
          <LinkRow icon={r.icon} label={r.label} value={r.value} valueColor={palette.accent} onPress={() =>
              r.to === '/partners' && Platform.OS !== 'web'
                ? void Linking.openURL(`${WEB_URL || 'https://lens.instagrowapp.com'}/affiliates/`)
                : router.push((signedIn ? r.to : '/signin') as Href)
            }
            external={r.to === '/partners' && Platform.OS !== 'web'}
          />
        </View>
      ))}
    </Section>
  );
}

/** Rate Lens, report a problem, suggest a feature (src/app/feedback.tsx). */
function FeedbackSection() {
  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; kind: string }[] = [
    { icon: 'star-outline', label: 'Rate Lens', kind: 'review' },
    { icon: 'bug-outline', label: 'Report a problem', kind: 'issue' },
    { icon: 'bulb-outline', label: 'Suggest a feature', kind: 'idea' },
  ];
  return (
    <Section title="Feedback" footer="Every message is read by the Lens team.">
      {rows.map((r, i) => (
        <View key={r.kind}>
          {i > 0 && <View style={styles.divider} />}
          <LinkRow icon={r.icon} label={r.label} onPress={() => router.push(`/feedback?kind=${r.kind}` as Href)} />
        </View>
      ))}
    </Section>
  );
}

/** Delete the account and everything in it (Google Play requirement; also on the website). */
function DeleteAccountSection({ onDeleted }: { onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const first = await confirmDestructive(
      'Delete your account?',
      'All your photos and videos in Lens (including Trash and Archive), shares, devices and sign-ins are deleted for good. Photos that are only inside Lens on this phone are removed too: save any you want to keep first. Files in your own Google Drive, Dropbox etc. stay there.',
      'Continue',
    );
    if (!first || !(await confirmDestructive('This can’t be undone', 'Delete the account and all its data now?', 'Delete account'))) return;
    setBusy(true);
    try {
      await deleteAccount();
      notify('Account deleted', 'Everything is being removed. It can take a few minutes for large libraries.');
      onDeleted();
    } catch (error) {
      notify('Could not delete the account', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Delete account" footer="Permanently deletes your Lens account and all its data. lens.instagrowapp.com/delete-account explains exactly what is removed.">
      <Pressable style={styles.rowButton} onPress={run} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color={colors.danger} /> : <Ionicons name="trash-outline" size={18} color={colors.danger} />}
        <Text style={[styles.rowButtonText, { color: colors.danger }]}>Delete account and data</Text>
      </Pressable>
    </Section>
  );
}

/** Computers signed in to the website (QR sign-in), and linking a new one. */
function ComputersSection() {
  const [browsers, setBrowsers] = useState<{ id: string; browser: string; createdAt: number }[] | null>(null);
  const load = () => api.webSessions().then((r) => setBrowsers(r.sessions), () => setBrowsers([]));
  useEffect(() => {
    void load();
  }, []);
  const logOutAll = async () => {
    if (!(await confirmDestructive('Log out all computers?', 'Every browser signed in to your Lens account will be signed out.', 'Log out'))) return;
    try {
      await api.signOutAllBrowsers();
      setBrowsers([]);
    } catch (error) {
      notify('Could not log out', errorMessage(error));
    }
  };
  return (
    <>
      <LinkRow icon="qr-code-outline" label="Link a computer" value="Scan QR" onPress={() => router.push('/scan')} />
      {browsers?.map((b) => (
        <View key={b.id}>
          <View style={styles.divider} />
          <Row icon="laptop-outline" label={b.browser} value={`since ${timeAgo(b.createdAt)}`} />
        </View>
      ))}
      {!!browsers?.length && (
        <>
          <View style={styles.divider} />
          <Pressable style={styles.rowButton} onPress={logOutAll}>
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={[styles.rowButtonText, { color: colors.danger }]}>Log out all computers</Text>
          </Pressable>
        </>
      )}
    </>
  );
}

/** Which notifications this account gets (server-side for pushes; "backup finished" is on-phone). */
function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [backup, setBackup] = useState(() => backupNotificationsEnabled());
  useEffect(() => {
    api.notificationPrefs().then(setPrefs, () => {});
  }, []);
  const change = (key: keyof NotificationPrefs, value: boolean) => {
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
    if (value) void askForNotifications();
    api.setNotificationPrefs({ [key]: value }).then(setPrefs, () => {});
  };
  const rows: [keyof NotificationPrefs, keyof typeof Ionicons.glyphMap, string, string][] = [
    ['shares', 'people-outline', 'Shares', 'Someone wants to share with you, or accepted what you sent.'],
    ['invites', 'gift-outline', 'Invites', 'A friend joined with your invite and you got more storage.'],
    ['storage', 'cloud-outline', 'Storage', 'Your Lens storage is nearly full.'],
  ];
  return (
    <Section title="Notifications" footer="Lens only notifies you about these. No marketing.">
      {rows.map(([key, icon, label, hint]) => (
        <View key={key}>
          <SwitchRow icon={icon} label={label} hint={hint} value={prefs ? prefs[key] : true} onChange={(v) => change(key, v)} />
          <View style={styles.divider} />
        </View>
      ))}
      <SwitchRow
        icon="checkmark-done-outline"
        label="Backup finished"
        hint="When a big backup completes while Lens is closed."
        value={backup}
        onChange={(v) => {
          setBackup(v);
          setBackupNotifications(v);
          if (v) void askForNotifications();
        }}
      />
    </Section>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [normalGrid, setNormalGrid] = useState(() => loadSettings().normalGrid);
  const [mirrorSelfies, setMirrorSelfies] = useState(() => loadSettings().mirrorSelfies);
  const [saveLocation, setSaveLocation] = useState(() => loadSettings().saveLocation);
  const [shutterSound, setShutterSound] = useState(() => loadSettings().shutterSound);
  const [scanCodes, setScanCodes] = useState(() => loadSettings().scanCodes);
  const [shareDiagnostics, setShareDiagnostics] = useState(() => diagnosticsEnabled());
  const [nearbyVisible, setNearbyVisible] = useState(false);
  useEffect(() => {
    if (nearbySupported) api.nearbySettings().then((r) => setNearbyVisible(r.visible), () => {});
  }, []);
  // Your name: shown to friends next to the Lens name (optional; src/components/RealNameSheet.tsx).
  const [realName, setRealName] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState('');
  const [editingName, setEditingName] = useState(false);
  useEffect(() => {
    api.me().then(
      (r) => {
        setRealName(r.realName ?? null);
        setSuggestedName(r.suggestedName ?? '');
      },
      () => {},
    );
  }, []);
  // People: may friends' phones suggest sharing photos of me with me? (off by default)
  const [suggestMe, setSuggestMe] = useState(false);
  useEffect(() => {
    if (!isWeb) api.peopleSuggest().then((r) => setSuggestMe(r.suggestMe), () => {});
  }, []);
  /** Opt-in location: ask for permission when switched on; stay off if refused. */
  const onSaveLocation = async (on: boolean) => {
    setSaveLocation(await setSaveLocationPref(on));
  };
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

  const lens = useStore((s) => s.storage?.lens);
  const usedPct = usage ? Math.min(1, usage.usedBytes / usage.quotaBytes) : 0;
  // Recent (newest, fastest storage) then Saver, as on the Storage screen.
  const recentPct = lens && usage ? Math.min(usedPct, lens.recentBytes / usage.quotaBytes) : usedPct;
  const saverPct = Math.max(0, usedPct - recentPct);

  // Fresh free-space reading (and a guardian pass) whenever Settings opens.
  useEffect(() => {
    if (!isWeb) guardSpace();
  }, []);

  // Gallery originals of imported items that are safe in Lens (Android).
  const galleryCount = useStore((s) => galleryCleanupCandidates(s).length);
  const galleryVideos = useStore((s) => galleryCleanupCandidates(s).filter((e) => e.kind === 'video').length);
  const galleryBytes = useStore((s) => galleryCleanupCandidates(s).reduce((n, e) => n + e.size, 0));
  const [galleryBusy, setGalleryBusy] = useState(false);
  const onRemoveFromGallery = async () => {
    if (!galleryCount || galleryBusy) return;
    const ok = await confirmDestructive(
      'Remove from phone gallery?',
      `${describeItems(galleryCount - galleryVideos, galleryVideos)} (${formatBytes(galleryBytes)}) ${galleryCount === 1 ? 'is' : 'are'} backed up in Lens. Each one is checked against its copy in Lens first; anything that doesn't match exactly stays. ${
        // Android 11+ asks first and keeps a trash; older Android deletes at once (GalleryCleanup.kt).
        Number(Platform.Version) >= 30
          ? 'Android will ask you to confirm, and keeps them in its trash for a while.'
          : 'This Android version has no gallery trash: they are deleted from the phone right away (your copy in Lens stays).'
      }`,
      'Check and remove',
    );
    if (!ok) return;
    setGalleryBusy(true);
    try {
      const r = await removeFromGallery();
      if (r.declined === 'permission') {
        notify('Gallery access needed', 'Lens needs access to your photos and videos to find and remove the backed-up ones. Nothing was removed.');
        return;
      }
      if (r.declined === 'confirm') {
        notify('Nothing removed', 'You kept them in your gallery.');
        return;
      }
      const kept = r.unverified ? ` ${r.unverified} kept: they didn't match their copy in Lens exactly.` : '';
      notify(r.removed ? `Freed ${formatBytes(r.bytes)}` : 'Nothing to remove', r.removed ? `Removed ${r.removed} from your gallery.${kept}` : `Nothing in your gallery needed removing.${kept}`);
    } catch (error) {
      notify('Couldn’t remove', errorMessage(error));
    } finally {
      setGalleryBusy(false);
    }
  };

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
        <Text style={typeStyle.largeTitle}>{isWeb ? 'Account' : 'Settings'}</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      {editingName && identity ? (
        <RealNameSheet
          lensName={identity.name}
          initial={realName ?? suggestedName}
          onDone={(name, saved) => {
            if (saved) setRealName(name);
            setEditingName(false);
          }}
        />
      ) : null}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        {/* Design A: who you are + your space, in one card. */}
        <View style={styles.accountCard}>
          {identity ? (
            <Pressable
              onPress={() => identity.name && Clipboard.setStringAsync(identity.name).then(() => notify('Name copied', 'Friends can find you by this name to send you photos.'))}
              style={styles.accountRow}
              accessibilityLabel={`You are ${identity.name}. Tap to copy your name`}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(realName || identity.name || identity.email)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {realName || identity.name || identity.email || 'Lens'}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {[realName ? identity.name : null, identity.email ?? 'Guest · photos tied to this phone'].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Ionicons name="copy-outline" size={16} color={palette.dim} />
            </Pressable>
          ) : (
            <Text style={styles.muted}>{online ? 'Setting up your cloud identity…' : 'Connect to the internet to set up your cloud identity.'}</Text>
          )}
          <View style={styles.spaceRow}>
            <Text style={styles.spaceBig}>
              {usage ? formatGB(usage.usedBytes) : '—'}
              <Text style={styles.spaceOf}>{usage ? `  of ${formatGB(usage.quotaBytes)}` : ''}</Text>
            </Text>
            {identity && (
              <Pressable onPress={() => router.push((identity.email ? '/invite' : '/signin') as Href)} hitSlop={8}>
                <Text style={styles.link}>{identity.email ? 'Get +10 GB' : 'Get 100 GB free'}</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${recentPct * 100}%` }]} />
            <View style={[styles.barFill, { width: `${saverPct * 100}%`, backgroundColor: palette.cloud }]} />
          </View>
          {lens && lens.usedBytes > 0 && (
            <View style={styles.legend}>
              <Text style={styles.legendText}>
                <Text style={{ color: palette.link }}>●</Text> Recent {formatGB(Math.min(lens.usedBytes, lens.recentBytes))}
              </Text>
              {lens.usedBytes > lens.recentBytes && (
                <Text style={styles.legendText}>
                  <Text style={{ color: palette.cloud }}>●</Text> Saver {formatGB(lens.usedBytes - lens.recentBytes)}
                </Text>
              )}
            </View>
          )}
        </View>

        {identity && (
          <View style={styles.section}>
            <View style={styles.card}>
              <LinkRow icon="cloud-outline" label="Storage" value="Lens & your own" onPress={() => router.push('/storage')} />
              <View style={styles.divider} />
              <LinkRow icon="trash-outline" label="Trash & Archive" onPress={() => router.push('/trash')} />
            </View>
          </View>
        )}

        {!isWeb && <AccountSection />}

        {identity && <EarnSection signedIn={!!identity.email} />}

        {identity && <FeedbackSection />}

        {!isWeb && (
          <>
            <Section
              title="On this device"
              footer="Every shot uploads to the cloud right away. The full-size original stays on the phone for the time you choose, and sooner if the phone runs low on space (oldest first). Nothing is removed until it's safely in the cloud, and previews always stay so your gallery works offline."
            >
              <Row label="Originals here" value={`${local.count} ${local.count === 1 ? 'item' : 'items'} · ${formatBytes(local.bytes)}`} />
              {local.offloaded > 0 && (
                <>
                  <View style={styles.divider} />
                  <Row label="Preview only (in the cloud)" value={`${local.offloaded} ${local.offloaded === 1 ? 'item' : 'items'}`} />
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
              {/* No icon: every row in this card starts on the same left edge. */}
              <Pressable style={styles.rowButton} onPress={onFreeUp} disabled={!local.freeableCount}>
                <Text style={[styles.rowButtonText, !local.freeableCount && { color: '#636366' }]}>
                  Free up space now{local.freeableCount ? ` (${formatBytes(local.freeable)})` : ''}
                </Text>
              </Pressable>
              {canRemoveFromGallery && galleryCount > 0 && (
                <>
                  <View style={styles.divider} />
                  <Pressable style={styles.rowButton} onPress={onRemoveFromGallery} disabled={galleryBusy}>
                    <Text style={[styles.rowButtonText, galleryBusy && { color: '#636366' }]}>
                      {galleryBusy ? 'Checking against Lens…' : `Remove ${galleryCount} backed-up from phone gallery (${formatBytes(galleryBytes)})`}
                    </Text>
                  </Pressable>
                </>
              )}
            </Section>

            {Platform.OS === 'android' && isProCameraAvailable && (
              <Section title="Camera">
                <SwitchRow icon="grid-outline" label="Grid" value={normalGrid} onChange={(v) => { setNormalGrid(v); setCameraOption('normalGrid', v); }} />
                <View style={styles.divider} />
                <SwitchRow
                  icon="person-circle-outline"
                  label="Mirror selfies"
                  value={mirrorSelfies}
                  onChange={(v) => {
                    setMirrorSelfies(v);
                    setCameraOption('mirrorSelfies', v);
                  }}
                />
                <View style={styles.divider} />
                <SwitchRow
                  icon="location-outline"
                  label="Save location"
                  hint="Adds where you took each photo and video. Photos you share keep it."
                  value={saveLocation}
                  onChange={(v) => void onSaveLocation(v)}
                />
                <View style={styles.divider} />
                <SwitchRow
                  icon="volume-medium-outline"
                  label="Shutter sound"
                  hint="Quiet when your phone is on silent or vibrate (where the law allows)."
                  value={shutterSound}
                  onChange={(v) => {
                    setShutterSound(v);
                    setCameraOption('shutterSound', v);
                  }}
                />
                {Platform.OS === 'android' && (
                  <>
                    <View style={styles.divider} />
                    <SwitchRow
                      icon="qr-code-outline"
                      label="Scan QR codes"
                      hint="Point the camera at a code: a link appears to open it."
                      value={scanCodes}
                      onChange={(v) => {
                        setScanCodes(v);
                        setCameraOption('scanCodes', v);
                      }}
                    />
                  </>
                )}
                <View style={styles.divider} />
                <SwitchRow
                  icon="pulse-outline"
                  label="Share camera diagnostics"
                  hint="Anonymous: your phone model, what its camera can do, and crash reports, so Lens works well on every phone. No photos, no location, not linked to you."
                  value={shareDiagnostics}
                  onChange={(v) => {
                    setShareDiagnostics(v);
                    setDiagnosticsEnabled(v);
                  }}
                />
                <View style={styles.divider} />
                <LinkRow icon="hardware-chip-outline" label="Camera info & self-test" onPress={() => router.push('/camera-info')} />
              </Section>
            )}

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
                    <Text style={[styles.rowButtonText, { color: colors.danger }]}>Retry {failed} failed</Text>
                  </Pressable>
                </>
              )}
            </Section>

            {Platform.OS === 'android' && identity ? <NotificationsSection /> : null}

            <Section title="Sharing" footer="Your Lens name is your identity; your name is shown next to it to people you share with. Friends scan your code to share with exactly you. You accept each share before it reaches your Shared tab, and you can cancel or revoke what you send.">
              {identity ? (
                <>
                  <LinkRow icon="person-outline" label="Your name" value={realName ?? 'Add'} valueColor={realName ? undefined : palette.link} onPress={() => setEditingName(true)} />
                  <View style={styles.divider} />
                </>
              ) : null}
              <LinkRow icon="qr-code-outline" label="My Lens code" onPress={() => router.push('/my-code')} />
              {nearbySupported ? (
                <>
                  <View style={styles.divider} />
                  <SwitchRow
                    icon="wifi-outline"
                    label="Visible to nearby Lens users"
                    hint="People on the same Wi-Fi who also turned this on see your Lens name, so they can share without searching. Only while Lens is open; never your location."
                    value={nearbyVisible}
                    onChange={(v) => {
                      setNearbyVisible(v);
                      api.setNearbyVisible(v).then(
                        (r) => {
                          setNearbyVisible(r.visible);
                          nearbyVisibilityChanged();
                        },
                        () => setNearbyVisible(!v),
                      );
                    }}
                  />
                </>
              ) : null}
              {peopleSupported ? (
                <>
                  <View style={styles.divider} />
                  <LinkRow icon="people-outline" label="People" onPress={() => router.push('/people')} />
                </>
              ) : null}
              {!isWeb ? (
                <>
                  <View style={styles.divider} />
                  <SwitchRow
                    icon="sparkles-outline"
                    label="Let friends' Lens suggest me"
                    hint="Friends who use People can get a suggestion to share photos of you with you. They still pick what to send and you still accept. Lens never sees faces."
                    value={suggestMe}
                    onChange={(v) => {
                      setSuggestMe(v);
                      api.setPeopleSuggest(v).then((r) => setSuggestMe(r.suggestMe), () => setSuggestMe(!v));
                    }}
                  />
                </>
              ) : null}
              <View style={styles.divider} />
              <LinkRow icon="swap-horizontal-outline" label="Requests and sent" onPress={() => router.push('/shares')} />
              <View style={styles.divider} />
              <LinkRow icon="link-outline" label="Share links" onPress={() => router.push('/links' as Href)} />
              <View style={styles.divider} />
              <LinkRow icon="hand-left-outline" label="Blocked people" onPress={() => router.push('/blocked')} />
            </Section>

            <Section title="Computers" footer="Use Lens on any computer: open lens.instagrowapp.com, click Sign in and scan the QR code. Only approve codes on a screen in front of you.">
              {identity ? <ComputersSection /> : <Text style={[styles.muted, { padding: 16 }]}>Available once you're online.</Text>}
            </Section>
          </>
        )}

        {isWeb && (
          <Section title="This browser">
            <Pressable
              style={styles.rowButton}
              onPress={async () => {
                if (await confirmDestructive('Sign out?', 'You can sign in again any time with your phone, email or Google.', 'Sign out')) {
                  await unlinkBrowser();
                  window.location.replace('/');
                }
              }}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.danger} />
              <Text style={[styles.rowButtonText, { color: colors.danger }]}>Sign out of this browser</Text>
            </Pressable>
          </Section>
        )}

        {identity && <DeleteAccountSection onDeleted={() => (isWeb ? window.location.replace('/') : router.replace('/'))} />}

        <Text style={styles.buildLabel} selectable>
          Lens · {buildLabel()}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 56 },
  done: { color: palette.link, fontSize: 17, fontWeight: '500' },
  accountCard: { marginTop: 12, marginHorizontal: 16, backgroundColor: palette.surface, borderRadius: 20, padding: 18 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: palette.surface2, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: palette.text, fontSize: 18, fontWeight: '700' },
  name: { color: palette.text, fontSize: 17, fontWeight: '600' },
  spaceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 18 },
  spaceBig: { color: palette.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.8 },
  spaceOf: { color: palette.muted, fontSize: 15, fontWeight: '500', letterSpacing: 0 },
  legend: { flexDirection: 'row', gap: 16, marginTop: 10 },
  legendText: { color: palette.muted, fontSize: 12 },
  muted: { color: palette.muted, fontSize: 13, marginTop: 2 },
  section: { marginTop: 22, paddingHorizontal: 16 },
  sectionTitle: { color: palette.muted, fontSize: 13, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: palette.surface, borderRadius: 20, overflow: 'hidden' },
  footer: { color: palette.dim, fontSize: 12, marginTop: 8, marginHorizontal: 4, lineHeight: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52 },
  rowLabel: { color: palette.text, fontSize: 16 },
  switchHint: { color: palette.muted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  rowValue: { color: palette.muted, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  rowButton: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52 },
  rowButtonText: { color: palette.link, fontSize: 16 },
  pressed: { backgroundColor: palette.surface2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.surface2, marginLeft: 16 },
  bar: { flexDirection: 'row', height: 6, borderRadius: 3, backgroundColor: palette.surface2, overflow: 'hidden', marginTop: 10 },
  barFill: { height: '100%', backgroundColor: palette.link },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16, paddingTop: 10 },
  chip: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: palette.surface2 },
  chipOn: { backgroundColor: palette.text },
  chipText: { color: palette.soft, fontSize: 14, fontWeight: '500' },
  chipTextOn: { color: '#000', fontWeight: '600' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.action,
    margin: 16,
    borderRadius: 980,
    minHeight: 48,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  link: { color: palette.link, fontSize: 14, fontWeight: '500' },
  code: { color: '#fff', fontSize: 36, fontWeight: '800', letterSpacing: 4, marginVertical: 8, fontVariant: ['tabular-nums'] },
  buildLabel: { color: palette.dim, fontSize: 10, fontFamily: font.mono, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', marginTop: 28, marginBottom: 8 },
});
