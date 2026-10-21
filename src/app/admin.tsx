// Admin (allow-listed accounts only; the API hides these routes from everyone
// else): approve affiliates, review held referral rewards, monthly payouts.
// Every action here is recorded in the audit log.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdminAffiliate, AdminPayout, api, ContactMessage, FeedbackItem, PhoneCount, PhoneStats } from '@/lib/api';
import { rupees } from '@/lib/format';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

type Tab = 'inbox' | 'feedback' | 'phones' | 'affiliates' | 'referrals' | 'payouts';
/** Affiliate approvals and payouts are managed on the website only (lens.instagrowapp.com/app/admin). */
const WEB_TOOLS = Platform.OS === 'web';
const TABS: Tab[] = WEB_TOOLS ? ['inbox', 'feedback', 'phones', 'affiliates', 'referrals', 'payouts'] : ['inbox', 'feedback', 'phones', 'referrals'];

function lastMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function Button({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={[styles.smallButton, danger && { backgroundColor: '#3A1D1D' }]} onPress={onPress}>
      <Text style={[styles.smallButtonText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

/** Contact-form messages (also emailed; reply from your mail app). */
function Inbox() {
  const [status, setStatus] = useState<'new' | 'done'>('new');
  const [rows, setRows] = useState<ContactMessage[] | null>(null);
  const load = useCallback(() => {
    api.admin.contact(status).then((r) => setRows(r.messages), (e) => notify('Error', errorMessage(e)));
  }, [status]);
  useEffect(load, [load]);
  const done = async (m: ContactMessage) => {
    try {
      await api.admin.closeContact(m.id);
      load();
    } catch (e) {
      notify('Error', errorMessage(e));
    }
  };
  const reply = (m: ContactMessage) =>
    Linking.openURL(`mailto:${m.email}?subject=${encodeURIComponent(`Re: your Lens message (${m.reference})`)}`).catch(() => undefined);
  return (
    <>
      <View style={styles.chips}>
        {(['new', 'done'] as const).map((s) => (
          <Pressable
            key={s}
            style={[styles.chip, s === status && styles.chipOn]}
            onPress={() => {
              setRows(null);
              setStatus(s);
            }}
          >
            <Text style={[styles.chipText, s === status && { color: '#000' }]}>{s}</Text>
          </Pressable>
        ))}
      </View>
      {!rows ? (
        <ActivityIndicator color={colors.link} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>No messages.</Text>
      ) : (
        rows.map((m) => (
          <View key={m.id} style={styles.card}>
            <Text style={styles.name}>
              {m.name} · {m.topic}
            </Text>
            <Text style={styles.small} selectable>
              {m.email} · {m.reference} · {new Date(m.at).toLocaleString()}
            </Text>
            <Text style={styles.body} selectable>
              {m.message}
            </Text>
            <View style={styles.actions}>
              <Button label="Reply" onPress={() => reply(m)} />
              {m.status === 'new' && <Button label="Mark done" onPress={() => done(m)} />}
            </View>
          </View>
        ))
      )}
    </>
  );
}

const KIND_LABEL: Record<string, string> = { review: 'Review', issue: 'Problem', idea: 'Idea', other: 'Other' };

/** Settings → Feedback submissions (ratings, reviews, problems, ideas). */
function Feedback() {
  const [status, setStatus] = useState<'new' | 'done'>('new');
  const [rows, setRows] = useState<FeedbackItem[] | null>(null);
  const load = useCallback(() => {
    api.admin.feedback(status).then((r) => setRows(r.feedback), (e) => notify('Error', errorMessage(e)));
  }, [status]);
  useEffect(load, [load]);
  const done = async (f: FeedbackItem) => {
    try {
      await api.admin.closeFeedback(f.id);
      load();
    } catch (e) {
      notify('Error', errorMessage(e));
    }
  };
  const reply = (f: FeedbackItem) =>
    Linking.openURL(`mailto:${f.email}?subject=${encodeURIComponent(`Re: your Lens feedback (${f.reference})`)}`).catch(() => undefined);
  const rated = (rows ?? []).filter((f) => f.rating);
  const avg = rated.length ? rated.reduce((n, f) => n + (f.rating ?? 0), 0) / rated.length : 0;
  return (
    <>
      <View style={styles.chips}>
        {(['new', 'done'] as const).map((st) => (
          <Pressable
            key={st}
            style={[styles.chip, st === status && styles.chipOn]}
            onPress={() => {
              setRows(null);
              setStatus(st);
            }}
          >
            <Text style={[styles.chipText, st === status && { color: '#000' }]}>{st}</Text>
          </Pressable>
        ))}
      </View>
      {rated.length > 0 && (
        <Text style={styles.small}>
          Average rating {avg.toFixed(1)} ★ from {rated.length} review{rated.length > 1 ? 's' : ''} (this list)
        </Text>
      )}
      {!rows ? (
        <ActivityIndicator color={colors.link} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>No feedback.</Text>
      ) : (
        rows.map((f) => (
          <View key={f.id} style={styles.card}>
            <Text style={styles.name}>
              {KIND_LABEL[f.kind] ?? f.kind}
              {f.rating ? ` · ${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}` : ''}
            </Text>
            <Text style={styles.small} selectable>
              {f.email ? `${f.email} (wants a reply)` : f.accountEmail ?? 'guest'} · {f.reference} · {new Date(f.at).toLocaleString()}
              {f.source && f.source !== 'settings' ? ` · from ${f.source === 'prompt' ? 'rating card' : '“missing?” card'}` : ''}
              {f.emailStatus === 'pending' ? ' · email pending' : ''}
            </Text>
            {f.device && (
              <Text style={styles.small} selectable>
                {Object.values(f.device).filter(Boolean).join(' · ')}
              </Text>
            )}
            {!!f.message && (
              <Text style={styles.body} selectable>
                {f.message}
              </Text>
            )}
            <View style={styles.actions}>
              {f.email && <Button label="Reply" onPress={() => reply(f)} />}
              {f.status === 'new' && <Button label="Mark done" onPress={() => done(f)} />}
            </View>
          </View>
        ))
      )}
    </>
  );
}

const FEATURE_LABEL: Record<string, string> = {
  bits64: '64-bit',
  ois: 'Optical stabilisation (OIS)',
  flash: 'Flash',
  video4k: '4K video',
  hdrVideo: 'HDR video',
  makerNight: "Maker's Night mode",
  slowMotion: 'Slow motion (CameraX)',
  slowMotionCamera2: 'High-speed camera (Camera2)',
  lowLightBoost: 'Low-light boost',
  concurrentCameras: 'Front + back at once (Dual)',
};

function monthsBack(n: number): string[] {
  const d = new Date();
  d.setUTCDate(1);
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d);
    m.setUTCMonth(d.getUTCMonth() - i);
    return m.toISOString().slice(0, 7);
  });
}

function Bars({ title, rows, total }: { title: string; rows: PhoneCount[]; total: number }) {
  if (!rows.length) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{title}</Text>
      {rows.map((r) => {
        const pct = total ? Math.round((r.count / total) * 100) : 0;
        return (
          <View key={r.label} style={{ gap: 3, marginTop: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={[styles.body, { flexShrink: 1 }]} numberOfLines={1} selectable>
                {r.label}
              </Text>
              <Text style={styles.small}>
                {r.count} · {pct}%
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.max(pct, 1)}%` }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Which phones Lens runs on (anonymous camera reports; counts only, never individual phones). */
function Phones() {
  const months = monthsBack(4);
  const [month, setMonth] = useState(months[0]);
  const [stats, setStats] = useState<PhoneStats | null>(null);
  useEffect(() => {
    let alive = true;
    api.admin.phones(month).then(
      (r) => alive && setStats(r),
      (e) => notify('Error', errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, [month]);
  return (
    <>
      <View style={styles.chips}>
        {months.map((m) => (
          <Pressable
            key={m}
            style={[styles.chip, m === month && styles.chipOn]}
            onPress={() => {
              if (m === month) return;
              setStats(null);
              setMonth(m);
            }}
          >
            <Text style={[styles.chipText, m === month && { color: '#000' }]}>{m}</Text>
          </Pressable>
        ))}
      </View>
      {!stats ? (
        <ActivityIndicator color={colors.link} />
      ) : stats.phones === 0 ? (
        <Text style={styles.empty}>No phone reports this month yet.</Text>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.name}>{stats.phones.toLocaleString()} phones</Text>
            <Text style={styles.small}>
              Phones that opened the camera this month with diagnostics on (Settings → Camera). Anonymous: a new random ID per phone each month.
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.name}>What the phones can do</Text>
            {Object.entries(stats.features).map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, gap: 8 }}>
                <Text style={[styles.body, { flexShrink: 1 }]}>{FEATURE_LABEL[k] ?? k}</Text>
                <Text style={styles.small}>{v.known ? `${Math.round((v.yes / v.known) * 100)}% (${v.yes} of ${v.known})` : 'not reported yet'}</Text>
              </View>
            ))}
          </View>
          <Bars title="Top models" rows={stats.models} total={stats.phones} />
          <Bars title="Android version" rows={stats.android} total={stats.phones} />
          <Bars title="Memory (RAM)" rows={stats.ram} total={stats.phones} />
          <Bars title="Brands" rows={stats.brands} total={stats.phones} />
          <Bars title="Lens camera tier" rows={stats.tiers} total={stats.phones} />
          <Bars title="Back camera level (Camera2)" rows={stats.cameraLevel} total={stats.phones} />
          <Bars title="Chips" rows={stats.chips} total={stats.phones} />
          <Bars title="Lens builds" rows={stats.builds} total={stats.phones} />
        </>
      )}
    </>
  );
}

function Affiliates() {
  const [status, setStatus] = useState('applied');
  const [rows, setRows] = useState<AdminAffiliate[] | null>(null);
  const load = useCallback(() => {
    api.admin.affiliates(status).then((r) => setRows(r.affiliates), (e) => notify('Error', errorMessage(e)));
  }, [status]);
  useEffect(load, [load]);
  const act = async (a: AdminAffiliate, action: string) => {
    if (action !== 'approve' && !(await confirmDestructive(`${action} ${a.name}?`, 'This is recorded in the audit log.', action))) return;
    try {
      await api.admin.decideAffiliate(a.id, action);
      load();
    } catch (e) {
      notify('Error', errorMessage(e));
    }
  };
  return (
    <>
      <View style={styles.chips}>
        {['applied', 'approved', 'suspended', 'rejected'].map((s) => (
          <Pressable
            key={s}
            style={[styles.chip, s === status && styles.chipOn]}
            onPress={() => {
              setRows(null);
              setStatus(s);
            }}
          >
            <Text style={[styles.chipText, s === status && { color: '#000' }]}>{s}</Text>
          </Pressable>
        ))}
      </View>
      {!rows ? (
        <ActivityIndicator color={colors.link} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>None</Text>
      ) : (
        rows.map((a) => (
          <View key={a.id} style={styles.card}>
            <Text style={styles.name}>{a.name}</Text>
            <Text style={styles.small}>{a.email}</Text>
            <Text style={styles.body}>{a.channels}</Text>
            {a.audience ? <Text style={styles.small}>{a.audience}</Text> : null}
            <Text style={styles.small}>
              PAN {a.panMasked ?? '—'} · UPI {a.upiMasked ?? '—'} · applied {new Date(a.appliedAt).toLocaleDateString()}
            </Text>
            <View style={styles.actions}>
              {a.status === 'applied' && <Button label="Approve" onPress={() => act(a, 'approve')} />}
              {a.status === 'applied' && <Button label="Reject" danger onPress={() => act(a, 'reject')} />}
              {a.status === 'approved' && <Button label="Suspend" danger onPress={() => act(a, 'suspend')} />}
              {a.status === 'suspended' && <Button label="Reinstate" onPress={() => act(a, 'reinstate')} />}
            </View>
          </View>
        ))
      )}
    </>
  );
}

function Referrals() {
  const [rows, setRows] = useState<{ inviterId: string; friendId: string; friendName: string; reason: string; at: number }[] | null>(null);
  const load = useCallback(() => {
    api.admin.heldReferrals().then((r) => setRows(r.held), (e) => notify('Error', errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  const act = async (friendId: string, action: 'release' | 'reject') => {
    try {
      const r = await api.admin.decideReferral(friendId, action);
      notify('Done', r.state);
      load();
    } catch (e) {
      notify('Error', errorMessage(e));
    }
  };
  if (!rows) return <ActivityIndicator color={colors.link} />;
  if (rows.length === 0) return <Text style={styles.empty}>No rewards waiting for review.</Text>;
  return (
    <>
      {rows.map((r) => (
        <View key={r.friendId} style={styles.card}>
          <Text style={styles.name}>{r.friendName}</Text>
          <Text style={styles.small}>
            Inviter {r.inviterId} · held for {r.reason} · {new Date(r.at).toLocaleString()}
          </Text>
          <View style={styles.actions}>
            <Button label="Grant" onPress={() => act(r.friendId, 'release')} />
            <Button label="Reject" danger onPress={() => act(r.friendId, 'reject')} />
          </View>
        </View>
      ))}
    </>
  );
}

function Payouts() {
  const [month, setMonth] = useState(lastMonth());
  const [rows, setRows] = useState<AdminPayout[] | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    api.admin.payouts(month).then((r) => setRows(r.payouts), (e) => notify('Error', errorMessage(e)));
  }, [month]);
  useEffect(load, [load]);
  const run = async () => {
    if (!(await confirmDestructive(`Create payouts for ${month}?`, 'Approved commissions of every partner above the minimum go into this month’s statements.', 'Create'))) return;
    try {
      const r = await api.admin.runPayouts(month);
      notify('Payouts created', `${r.payouts.length} new statement(s)`);
      load();
    } catch (e) {
      notify('Error', errorMessage(e));
    }
  };
  const exportSheet = () => {
    const lines = ['name,email,upi,pan,gross,tds,net,status'];
    for (const p of rows ?? []) {
      lines.push([p.name, p.email, p.upi, p.pan, p.grossPaise / 100, p.tdsPaise / 100, p.netPaise / 100, p.status].join(','));
    }
    void Share.share({ message: lines.join('\n') });
  };
  const paid = async (p: AdminPayout) => {
    try {
      await api.admin.markPaid(p.affiliateId, month, refs[p.affiliateId] ?? '');
      load();
    } catch (e) {
      notify('Error', errorMessage(e));
    }
  };
  return (
    <>
      <View style={[styles.actions, { paddingHorizontal: 16 }]}>
        <TextInput style={[styles.input, { flex: 1 }]} value={month} onChangeText={setMonth} placeholder="YYYY-MM" placeholderTextColor="#636366" />
        <Button label="Create" onPress={run} />
        <Button label="Export" onPress={exportSheet} />
      </View>
      {!rows ? (
        <ActivityIndicator color={colors.link} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>No payouts for {month}.</Text>
      ) : (
        rows.map((p) => (
          <View key={p.affiliateId} style={styles.card}>
            <Text style={styles.name}>
              {p.name} · {rupees(p.netPaise)}
            </Text>
            <Text style={styles.small} selectable>
              UPI {p.upi ?? '—'} · PAN {p.pan ?? '— (20% TDS)'}
            </Text>
            <Text style={styles.small}>
              Commission {rupees(p.grossPaise)} − TDS {rupees(p.tdsPaise)} · {p.status}
              {p.reference ? ` · Ref ${p.reference}` : ''}
            </Text>
            {p.status === 'due' && (
              <View style={styles.actions}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={refs[p.affiliateId] ?? ''}
                  onChangeText={(v) => setRefs({ ...refs, [p.affiliateId]: v })}
                  placeholder="UPI reference"
                  placeholderTextColor="#636366"
                />
                <Button label="Mark paid" onPress={() => paid(p)} />
              </View>
            )}
          </View>
        ))
      )}
    </>
  );
}

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('inbox');
  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin</Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
      <View style={styles.chips}>
        {TABS.map((t) => (
          <Pressable key={t} style={[styles.chip, t === tab && styles.chipOn]} onPress={() => setTab(t)}>
            <Text style={[styles.chipText, t === tab && { color: '#000' }]}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32, gap: 10 }} keyboardShouldPersistTaps="handled">
        {tab === 'inbox' && <Inbox />}
        {tab === 'feedback' && <Feedback />}
        {tab === 'phones' && <Phones />}
        {tab === 'affiliates' && WEB_TOOLS && <Affiliates />}
        {tab === 'referrals' && <Referrals />}
        {tab === 'payouts' && WEB_TOOLS && <Payouts />}
        {!WEB_TOOLS && tab === 'inbox' && (
          <Pressable onPress={() => void Linking.openURL('https://lens.instagrowapp.com/app/admin')}>
            <Text style={styles.done}>Affiliate approvals and payouts: open admin on the web ›</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 56 },
  title: { color: '#fff', fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  done: { color: colors.link, fontSize: 17, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#2C2C2E' },
  chipOn: { backgroundColor: colors.text },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '500', textTransform: 'capitalize' },
  card: { backgroundColor: '#1C1C1E', borderRadius: 20, marginHorizontal: 16, padding: 14, gap: 4 },
  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  body: { color: '#E8E8ED', fontSize: 14 },
  small: { color: colors.muted, fontSize: 12 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  smallButton: { backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  smallButtonText: { color: colors.link, fontWeight: '700' },
  input: { color: '#fff', fontSize: 15, backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 12, minHeight: 40 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: '#2C2C2E', overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.link },
});
