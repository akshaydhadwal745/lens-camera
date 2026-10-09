import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import {
  connectorFor,
  ConnectCancelled,
  connectStorage,
  connectWithCredentials,
  CredentialsForm,
  disconnectStorage,
  isOAuth,
} from '@/lib/storage';
import { PROVIDERS, providerInfo } from '@/lib/storage/providers';
import { checkStorages, kickSync, refreshStorage, requestProvider, useStore } from '@/lib/store';
import { ConnectedStorage, ProviderId } from '@/lib/types';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

const RECENT_COLOR = colors.accent;
const SAVER_COLOR = '#60A5FA';

function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

function LensStorageCard() {
  const storage = useStore((s) => s.storage);
  if (!storage) return <ActivityIndicator color="#fff" style={{ padding: 24 }} />;
  const { usedBytes, quotaBytes, recentBytes } = storage.lens;
  const recent = Math.min(usedBytes, recentBytes);
  const saver = Math.max(0, usedBytes - recentBytes);
  const pct = (n: number) => `${Math.min(100, (n / quotaBytes) * 100)}%` as const;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={styles.big}>
        {formatBytes(usedBytes)} <Text style={styles.muted}>of {formatBytes(quotaBytes)} free storage</Text>
      </Text>
      <View style={styles.bar}>
        <View style={{ width: pct(recent), backgroundColor: RECENT_COLOR }} />
        <View style={{ width: pct(saver), backgroundColor: SAVER_COLOR }} />
      </View>
      <View style={styles.legendRow}>
        <View style={[styles.dot, { backgroundColor: RECENT_COLOR }]} />
        <Text style={styles.legendText}>
          <Text style={styles.legendName}>Recent</Text> · your newest {formatBytes(recentBytes)}, kept in our fastest storage
        </Text>
      </View>
      <View style={styles.legendRow}>
        <View style={[styles.dot, { backgroundColor: SAVER_COLOR }]} />
        <Text style={styles.legendText}>
          <Text style={styles.legendName}>Saver</Text> · everything older, stored more efficiently. Still opens instantly.
        </Text>
      </View>
      {!storage.signedIn && (
        <Pressable style={styles.guestNote} onPress={() => router.push('/signin')}>
          <Ionicons name="person-circle-outline" size={18} color={colors.accent} />
          <Text style={[styles.legendText, { color: '#fff' }]}>
            Guests get {formatBytes(quotaBytes)}. <Text style={{ color: colors.accent, fontWeight: '700' }}>Sign in</Text> to get{' '}
            {formatBytes(storage.lens.signedInQuotaBytes)} free.
          </Text>
        </Pressable>
      )}
      <View style={styles.legendRow}>
        <Ionicons name="shield-checkmark-outline" size={14} color="#4ADE80" />
        <Text style={styles.legendText}>
          Deleted by mistake? Items in Lens storage can be recovered for <Text style={styles.legendName}>a year</Text>. Most
          clouds keep them for 30 days.
        </Text>
      </View>
    </View>
  );
}

function statusText(s: ConnectedStorage): { text: string; color: string } {
  switch (s.status) {
    case 'ok':
      return { text: 'Working', color: '#4ADE80' };
    case 'low':
      return { text: 'Almost full', color: '#FBBF24' };
    case 'full':
      return { text: 'Full: new shots go to Lens storage', color: colors.danger };
    case 'signed-out':
      return { text: 'Signed out: sign in again', color: colors.danger };
    default:
      return { text: 'Can’t reach it right now', color: colors.danger };
  }
}

async function connect(provider: ProviderId, reconnectId?: string) {
  try {
    await connectStorage(provider, reconnectId);
    await refreshStorage();
    kickSync();
    notify('Connected', `New photos and videos will be saved to your ${providerInfo(provider).name}.`);
  } catch (error) {
    if (error instanceof ConnectCancelled) return;
    notify('Could not connect', errorMessage(error));
  }
}

function ConnectedCard({ storage }: { storage: ConnectedStorage }) {
  const info = providerInfo(storage.provider);
  const status = statusText(storage);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify('Something went wrong', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () =>
    run(async () => {
      const ok = await confirmDestructive(
        `Disconnect ${storage.label}?`,
        `New photos and videos will go to Lens storage. Everything already in your ${info.name} stays there, and Lens keeps showing its previews.`,
        'Disconnect',
      );
      if (!ok) return;
      await disconnectStorage(storage.id);
      await refreshStorage();
    });

  return (
    <View style={{ padding: 16, gap: 6 }}>
      <View style={styles.providerRow}>
        <Ionicons name={info.icon} size={22} color="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={styles.providerName}>{storage.label}</Text>
          {storage.account ? <Text style={styles.muted}>{storage.account}</Text> : null}
        </View>
      </View>
      <Text style={{ color: status.color, fontSize: 14, fontWeight: '600' }}>{status.text}</Text>
      {storage.totalBytes ? (
        <Text style={styles.muted}>
          {formatBytes(storage.usedBytes ?? 0)} used of {formatBytes(storage.totalBytes)}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {storage.status === 'signed-out' ? (
          <Pressable style={styles.smallButton} onPress={() => run(() => connect(storage.provider, storage.id))}>
            <Text style={styles.smallButtonText}>Sign in again</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.smallButton} onPress={() => run(() => checkStorages(true))}>
            <Text style={styles.smallButtonText}>Check now</Text>
          </Pressable>
        )}
        <Pressable style={[styles.smallButton, styles.dangerButton]} onPress={disconnect}>
          <Text style={[styles.smallButtonText, { color: colors.danger }]}>Disconnect</Text>
        </Pressable>
        {busy && <ActivityIndicator color="#fff" />}
      </View>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  hint?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor="#666"
        style={styles.input}
        secureTextEntry={props.secure}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {props.hint ? <Text style={styles.muted}>{props.hint}</Text> : null}
    </View>
  );
}

/** Keys / password form for S3-compatible storage and WebDAV (NAS, Nextcloud). */
function CredentialsSheet({ provider, onDone }: { provider: 's3' | 'webdav'; onDone: () => void }) {
  const [v, setV] = useState({ endpoint: '', region: '', bucket: '', prefix: 'Lens/', key: '', secret: '', url: '', user: '', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (value: string) => setV((prev) => ({ ...prev, [k]: value }));

  const complete =
    provider === 's3' ? v.endpoint && v.bucket && v.key && v.secret : v.url && v.user && v.password;

  const submit = async () => {
    if (!complete || busy) return;
    setBusy(true);
    try {
      const prefix = v.prefix.trim() ? `${v.prefix.trim().replace(/^\/+|\/+$/g, '')}/` : '';
      const form: CredentialsForm =
        provider === 's3'
          ? {
              provider,
              config: {
                endpoint: v.endpoint.trim().replace(/\/+$/, ''),
                region: v.region.trim() || 'us-east-1',
                bucket: v.bucket.trim(),
                prefix,
                pathStyle: 'true',
              },
              accessKeyId: v.key,
              secretAccessKey: v.secret,
            }
          : { provider, config: { url: v.url.trim(), username: v.user.trim() }, password: v.password };
      await connectWithCredentials(form);
      await refreshStorage();
      kickSync();
      notify('Connected', 'New photos and videos will be saved there.');
      onDone();
    } catch (error) {
      notify('Could not connect', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={styles.providerName}>{provider === 's3' ? 'S3-compatible storage' : 'WebDAV / NAS'}</Text>
      {provider === 's3' ? (
        <>
          <Field label="Endpoint" value={v.endpoint} onChange={set('endpoint')} placeholder="https://s3.eu-central-003.backblazeb2.com" />
          <Field label="Region" value={v.region} onChange={set('region')} placeholder="us-east-1 (R2: auto)" />
          <Field label="Bucket" value={v.bucket} onChange={set('bucket')} placeholder="my-photos" />
          <Field label="Folder" value={v.prefix} onChange={set('prefix')} placeholder="Lens/" />
          <Field label="Access key ID" value={v.key} onChange={set('key')} />
          <Field label="Secret access key" value={v.secret} onChange={set('secret')} secure />
        </>
      ) : (
        <>
          <Field
            label="Folder address"
            value={v.url}
            onChange={set('url')}
            placeholder="https://cloud.example.com/remote.php/dav/files/me/Lens/"
            hint="The WebDAV address of the folder for your photos (created if it doesn’t exist)."
          />
          <Field label="User name" value={v.user} onChange={set('user')} />
          <Field label="Password" value={v.password} onChange={set('password')} secure hint="Use an app password if your server offers one." />
        </>
      )}
      <Text style={styles.muted}>
        Your keys stay on this phone. Lens checks access before connecting. Deleting in Lens keeps the file in your storage until you
        choose Delete forever.
      </Text>
      <View style={styles.actions}>
        <Pressable style={[styles.button, { flex: 1 }, !complete && { opacity: 0.5 }]} onPress={submit} disabled={!complete || busy}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Test & connect</Text>}
        </Pressable>
        <Pressable style={styles.smallButton} onPress={onDone}>
          <Text style={styles.smallButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RequestProvider() {
  const [provider, setProvider] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!provider.trim() || sending) return;
    setSending(true);
    try {
      await requestProvider(provider.trim(), note.trim() || undefined);
      setProvider('');
      setNote('');
      notify('Thanks!', 'We’ll let you know when it’s supported.');
    } catch (error) {
      notify('Could not send', errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ padding: 16, gap: 10 }}>
      <TextInput
        value={provider}
        onChangeText={setProvider}
        placeholder="Which storage do you use?"
        placeholderTextColor="#666"
        style={styles.input}
        maxLength={80}
        autoCapitalize="words"
        returnKeyType="next"
      />
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Anything we should know? (optional)"
        placeholderTextColor="#666"
        style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]}
        maxLength={500}
        multiline
      />
      <Pressable style={[styles.button, !provider.trim() && { opacity: 0.5 }]} onPress={send} disabled={!provider.trim() || sending}>
        {sending ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Send request</Text>}
      </Pressable>
    </View>
  );
}

export default function StorageScreen() {
  const insets = useSafeAreaInsets();
  const storage = useStore((s) => s.storage);
  const connected = storage?.storages ?? [];
  const own = connected[0];
  const [configured, setConfigured] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [connecting, setConnecting] = useState<ProviderId | null>(null);
  const [form, setForm] = useState<'s3' | 'webdav' | null>(null);

  useEffect(() => {
    void refreshStorage();
    api
      .oauthProviders()
      .then((r) => setConfigured(r.providers))
      .catch(() => {});
  }, []);

  const canConnect = (id: ProviderId) => !!connectorFor(id) && (isOAuth(id) ? !!configured[id] : true);

  const onProvider = async (id: ProviderId) => {
    const p = providerInfo(id);
    if (!canConnect(id)) {
      notify(p.name, p.unavailable ?? 'Coming in the next update.');
      return;
    }
    if (id === 's3' || id === 'webdav') {
      setForm(id);
      return;
    }
    setConnecting(id);
    try {
      await connect(id);
    } finally {
      setConnecting(null);
    }
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Storage</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32, maxWidth: 640, width: '100%', alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        <Section
          title="New photos & videos go to"
          footer={
            own
              ? 'Originals go only to your storage, at full quality. Lens keeps small previews so your gallery stays fast and works offline.'
              : 'Connect your own storage to keep your originals there instead. Lens keeps small previews so your gallery stays fast.'
          }
        >
          <View style={[styles.providerRow, { padding: 16 }]}>
            <Ionicons name={own ? providerInfo(own.provider).icon : 'cloud-outline'} size={24} color={colors.accent} />
            <Text style={styles.providerName}>{own ? own.label : 'Lens storage'}</Text>
          </View>
        </Section>

        <Section title="Lens storage">
          <LensStorageCard />
        </Section>

        <Section
          title="Your storage"
          footer="Free plan: connect one storage. Sending photos to one storage and videos to another comes with Lens Plus."
        >
          {own ? (
            <ConnectedCard storage={own} />
          ) : form ? (
            <CredentialsSheet provider={form} onDone={() => setForm(null)} />
          ) : (
            PROVIDERS.map((p, i) => (
              <View key={p.id}>
                {i > 0 && <View style={styles.divider} />}
                <Pressable
                  style={styles.providerItem}
                  onPress={() => onProvider(p.id)}
                  disabled={!!connecting}
                  accessibilityLabel={`Connect ${p.name}`}
                >
                  <Ionicons name={p.icon} size={22} color="#fff" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.providerName}>{p.name}</Text>
                    <Text style={styles.muted}>{p.blurb}</Text>
                  </View>
                  {connecting === p.id ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Text style={[styles.connect, !canConnect(p.id) && { color: '#666' }]}>
                      {canConnect(p.id) ? 'Connect' : (p.unavailable ?? 'Soon')}
                    </Text>
                  )}
                </Pressable>
              </View>
            ))
          )}
        </Section>

        <Section title="Don’t see yours?" footer="Tell us which storage you use. We add the most requested ones first.">
          <RequestProvider />
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0B0B0D' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  done: { color: colors.accent, fontSize: 17, fontWeight: '600' },
  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: '#1C1C1E', borderRadius: 14, overflow: 'hidden' },
  footer: { color: '#777', fontSize: 12, marginTop: 8, marginHorizontal: 4, lineHeight: 17 },
  big: { color: '#fff', fontSize: 20, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13, fontWeight: '400' },
  bar: { height: 10, borderRadius: 5, backgroundColor: '#333', overflow: 'hidden', flexDirection: 'row' },
  legendRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  legendText: { color: '#bbb', fontSize: 13, lineHeight: 18, flex: 1 },
  legendName: { color: '#fff', fontWeight: '700' },
  guestNote: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2C2C2E', borderRadius: 10, padding: 10 },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  providerItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  providerName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  connect: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#333', marginLeft: 50 },
  fieldLabel: { color: '#bbb', fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 15 },
  button: { backgroundColor: colors.accent, borderRadius: 12, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 15 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  smallButton: { backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  dangerButton: { backgroundColor: '#2A1515' },
  smallButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
