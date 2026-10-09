// Affiliate program (creators, photographers, bloggers): apply, then share
// tracking links and earn 50% of the net revenue from the users you bring.
// Payments aren't live yet, so earnings stay at ₹0 until Play Billing ships.
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AffiliateDashboard, api, WEB_URL } from '@/lib/api';
import { rupees } from '@/lib/format';
import { colors, errorMessage, notify } from '@/lib/ui';

const WEB = WEB_URL || 'https://lens.instagrowapp.com';

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; caps?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={[styles.input, props.multiline && { minHeight: 72, textAlignVertical: 'top', paddingTop: 12 }]}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor="#666"
        multiline={props.multiline}
        autoCapitalize={props.caps ? 'characters' : 'sentences'}
        autoCorrect={false}
      />
    </View>
  );
}

function Card({ title, children, footer }: { title: string; children: ReactNode; footer?: string }) {
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.small}>{label}</Text>
      {hint ? <Text style={[styles.small, { color: '#666' }]}>{hint}</Text> : null}
    </View>
  );
}

function ApplyForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [channels, setChannels] = useState('');
  const [audience, setAudience] = useState('');
  const [pan, setPan] = useState('');
  const [upi, setUpi] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.applyAffiliate({ name, channels, audience, pan: pan || undefined, upi: upi || undefined, agree });
      notify('Application sent', 'We review applications within a few days and email you.');
      onDone();
    } catch (e) {
      notify('Could not apply', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Apply"
      footer="PAN and UPI are needed before your first payout (tax rules); you can add them later. They are stored encrypted and shown masked."
    >
      <View style={{ padding: 16, gap: 14 }}>
        <Field label="Your name (as on PAN)" value={name} onChange={setName} />
        <Field label="Where will you share Lens?" value={channels} onChange={setChannels} placeholder="YouTube / Instagram / blog links" multiline />
        <Field label="Your audience (optional)" value={audience} onChange={setAudience} placeholder="e.g. 40k followers, travel photography" />
        <Field label="PAN (optional now)" value={pan} onChange={(v) => setPan(v.toUpperCase())} placeholder="ABCDE1234F" caps />
        <Field label="UPI ID (optional now)" value={upi} onChange={setUpi} placeholder="name@bank" />
        <Pressable style={styles.check} onPress={() => setAgree(!agree)} accessibilityRole="checkbox" accessibilityState={{ checked: agree }}>
          <Ionicons name={agree ? 'checkbox' : 'square-outline'} size={22} color={agree ? colors.accent : '#888'} />
          <Text style={[styles.muted, { flex: 1 }]}>
            I agree to the{' '}
            <Text style={styles.linkText} onPress={() => Linking.openURL(`${WEB}/affiliate-terms/`)}>
              affiliate terms
            </Text>{' '}
            (no fake installs, no self-purchases, #ad disclosure on posts).
          </Text>
        </Pressable>
        <Pressable style={styles.button} onPress={submit} disabled={busy || !agree || !name.trim() || !channels.trim()}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Send application</Text>}
        </Pressable>
      </View>
    </Card>
  );
}

function PayoutDetails({ data, onSaved }: { data: AffiliateDashboard; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pan, setPan] = useState('');
  const [upi, setUpi] = useState('');
  const save = async () => {
    try {
      await api.affiliatePayoutDetails({ pan: pan || undefined, upi: upi || undefined });
      setEditing(false);
      setPan('');
      setUpi('');
      onSaved();
    } catch (e) {
      notify('Could not save', errorMessage(e));
    }
  };
  return (
    <Card title="Payout details" footer="Without a PAN, the law requires 20% TDS instead of 2%.">
      {editing ? (
        <View style={{ padding: 16, gap: 14 }}>
          <Field label="PAN" value={pan} onChange={(v) => setPan(v.toUpperCase())} placeholder={data.panMasked ?? 'ABCDE1234F'} caps />
          <Field label="UPI ID" value={upi} onChange={setUpi} placeholder={data.upiMasked ?? 'name@bank'} />
          <Pressable style={styles.button} onPress={save} disabled={!pan && !upi}>
            <Text style={styles.buttonText}>Save</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>PAN</Text>
            <Text style={styles.rowValue}>{data.panMasked ?? 'Not added'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>UPI</Text>
            <Text style={styles.rowValue}>{data.upiMasked ?? 'Not added'}</Text>
          </View>
          <View style={styles.divider} />
          <Pressable style={styles.rowButton} onPress={() => setEditing(true)}>
            <Ionicons name="create-outline" size={18} color={colors.accent} />
            <Text style={styles.rowButtonText}>Update</Text>
          </Pressable>
        </>
      )}
    </Card>
  );
}

function Approved({ data, reload }: { data: AffiliateDashboard; reload: () => void }) {
  const [campaign, setCampaign] = useState('');
  const links = data.links ?? [];
  const totals = links.reduce((t, l) => ({ clicks: t.clicks + l.clicks, signups: t.signups + l.signups, payers: t.payers + l.payers }), {
    clicks: 0,
    signups: 0,
    payers: 0,
  });
  const newLink = async () => {
    try {
      await api.createAffiliateLink(campaign.trim() || 'default');
      setCampaign('');
      reload();
    } catch (e) {
      notify('Could not create the link', errorMessage(e));
    }
  };
  return (
    <>
      <Card title="Earnings" footer={`Commissions are approved ${data.holdDays ?? 30} days after a payment (refund window), then paid monthly once you have at least ${rupees(data.minPayoutPaise)}.`}>
        <View style={styles.stats}>
          <Stat label="On hold" value={rupees(data.pendingPaise)} />
          <Stat label="Approved" value={rupees((data.approvedPaise ?? 0) + (data.inPayoutPaise ?? 0))} />
          <Stat label="Paid" value={rupees(data.paidPaise)} />
        </View>
      </Card>
      <Card title="Funnel (last 12 months)">
        <View style={styles.stats}>
          <Stat label="Clicks" value={String(totals.clicks)} />
          <Stat label="Sign-ups" value={String(totals.signups)} />
          <Stat label="Paying" value={String(totals.payers)} />
        </View>
      </Card>
      <Card title="Your links" footer="Use a separate link per platform or campaign to see what works.">
        {links.map((l, i) => (
          <View key={l.code}>
            {i > 0 && <View style={styles.divider} />}
            <View style={[styles.row, { paddingVertical: 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{l.campaign}</Text>
                <Text style={styles.small} selectable>
                  {l.url}
                </Text>
                <Text style={styles.small}>
                  {l.clicks} clicks · {l.signups} sign-ups · {l.payers} paying · {rupees(l.commissionPaise)}
                </Text>
              </View>
              <Pressable hitSlop={10} onPress={() => Clipboard.setStringAsync(l.url).then(() => notify('Link copied', l.url))}>
                <Ionicons name="copy-outline" size={20} color={colors.accent} />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => Share.share({ message: `Lens: back up every photo in full quality. ${l.url}` })}>
                <Ionicons name="share-outline" size={20} color={colors.accent} />
              </Pressable>
            </View>
          </View>
        ))}
        <View style={styles.divider} />
        <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
          <TextInput style={[styles.input, { flex: 1 }]} value={campaign} onChangeText={setCampaign} placeholder="New link, e.g. instagram" placeholderTextColor="#666" />
          <Pressable style={[styles.button, { marginTop: 0, paddingHorizontal: 16 }]} onPress={newLink}>
            <Text style={styles.buttonText}>Add</Text>
          </Pressable>
        </View>
      </Card>
      {!!data.payouts?.length && (
        <Card title="Payouts">
          {data.payouts.map((p, i) => (
            <View key={p.month}>
              {i > 0 && <View style={styles.divider} />}
              <View style={[styles.row, { paddingVertical: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{p.month}</Text>
                  <Text style={styles.small}>
                    {rupees(p.grossPaise)} − TDS {rupees(p.tdsPaise)}
                    {p.reference ? ` · Ref ${p.reference}` : ''}
                  </Text>
                </View>
                <Text style={styles.rowValue}>
                  {rupees(p.netPaise)} {p.status === 'paid' ? '✓' : '(due)'}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      )}
      <PayoutDetails data={data} onSaved={reload} />
    </>
  );
}

export default function PartnersScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<AffiliateDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.affiliate().then(setData, (e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const rate = data ? `${data.rateBps / 100}%` : '50%';
  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Affiliate program</Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {error ? (
          <Text style={[styles.muted, { padding: 24 }]}>{error}</Text>
        ) : !data ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <View style={styles.hero}>
              <Ionicons name="trending-up-outline" size={40} color={colors.accent} />
              <Text style={styles.heroTitle}>Earn {rate} of what your users pay</Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                For creators, photographers and bloggers. You earn {rate} of our net revenue (after GST and store fees) from every user you bring, for as long as they pay.
              </Text>
            </View>
            {data.status === 'none' && <ApplyForm onDone={load} />}
            {data.status === 'rejected' && (
              <>
                <Text style={[styles.muted, { padding: 20 }]}>Your application wasn’t approved{data.note ? `: ${data.note}` : '.'} You can apply again.</Text>
                <ApplyForm onDone={load} />
              </>
            )}
            {data.status === 'applied' && (
              <Text style={[styles.muted, { padding: 20, textAlign: 'center' }]}>Thanks for applying! We’ll email you when your account is approved.</Text>
            )}
            {data.status === 'suspended' && (
              <Text style={[styles.muted, { padding: 20 }]}>Your affiliate account is paused{data.note ? `: ${data.note}` : '.'} Contact us at lens.instagrowapp.com/contact/.</Text>
            )}
            {(data.status === 'approved' || data.status === 'suspended') && <Approved data={data} reload={load} />}
          </>
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
  hero: { alignItems: 'center', gap: 10, padding: 24 },
  heroTitle: { color: '#fff', fontSize: 21, fontWeight: '800', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  small: { color: colors.muted, fontSize: 12, marginTop: 2 },
  label: { color: '#bbb', fontSize: 13, fontWeight: '600' },
  linkText: { color: '#60A5FA' },
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 20, marginBottom: 8, marginLeft: 20 },
  card: { backgroundColor: '#1C1C1E', borderRadius: 14, overflow: 'hidden', marginHorizontal: 16 },
  footer: { color: '#777', fontSize: 12, marginTop: 8, marginHorizontal: 20, lineHeight: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, minHeight: 48, gap: 12 },
  rowLabel: { color: '#fff', fontSize: 15 },
  rowValue: { color: colors.muted, fontSize: 15 },
  rowButton: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 48 },
  rowButtonText: { color: colors.accent, fontSize: 15, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#333', marginLeft: 16 },
  stats: { flexDirection: 'row', padding: 12 },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 6 },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  input: { color: '#fff', fontSize: 16, backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 12, minHeight: 46 },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    marginTop: 4,
    borderRadius: 12,
    minHeight: 46,
  },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 15 },
});
