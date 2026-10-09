// Admin (allow-listed accounts only; the API hides these routes from everyone
// else): approve affiliates, review held referral rewards, monthly payouts.
// Every action here is recorded in the audit log.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdminAffiliate, AdminPayout, api, ContactMessage } from '@/lib/api';
import { rupees } from '@/lib/format';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

type Tab = 'inbox' | 'affiliates' | 'referrals' | 'payouts';

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
        <ActivityIndicator color={colors.accent} />
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
        <ActivityIndicator color={colors.accent} />
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
  if (!rows) return <ActivityIndicator color={colors.accent} />;
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
        <TextInput style={[styles.input, { flex: 1 }]} value={month} onChangeText={setMonth} placeholder="YYYY-MM" placeholderTextColor="#666" />
        <Button label="Create" onPress={run} />
        <Button label="Export" onPress={exportSheet} />
      </View>
      {!rows ? (
        <ActivityIndicator color={colors.accent} />
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
                  placeholderTextColor="#666"
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
        {(['inbox', 'affiliates', 'referrals', 'payouts'] as Tab[]).map((t) => (
          <Pressable key={t} style={[styles.chip, t === tab && styles.chipOn]} onPress={() => setTab(t)}>
            <Text style={[styles.chipText, t === tab && { color: '#000' }]}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32, gap: 10 }} keyboardShouldPersistTaps="handled">
        {tab === 'inbox' && <Inbox />}
        {tab === 'affiliates' && <Affiliates />}
        {tab === 'referrals' && <Referrals />}
        {tab === 'payouts' && <Payouts />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0B0B0D' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  done: { color: colors.accent, fontSize: 17, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#2C2C2E' },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: '#fff', fontSize: 14, fontWeight: '500', textTransform: 'capitalize' },
  card: { backgroundColor: '#1C1C1E', borderRadius: 14, marginHorizontal: 16, padding: 14, gap: 4 },
  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  body: { color: '#ddd', fontSize: 14 },
  small: { color: colors.muted, fontSize: 12 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  smallButton: { backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  smallButtonText: { color: colors.accent, fontWeight: '700' },
  input: { color: '#fff', fontSize: 15, backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 12, minHeight: 40 },
});
