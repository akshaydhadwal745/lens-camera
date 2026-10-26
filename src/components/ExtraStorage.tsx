// Extra storage above Lens Plus (docs/features/extra-storage.md): ₹3 per GB a month for what's kept
// above 50 GB, measured daily, added to the monthly Lens Plus payment. The person picks the most it
// can cost (the cap); turning it on or raising it always shows the price and asks first.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { api, ExtraStatus } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { rupees } from '@/lib/pay-channel';
import { refreshStorage } from '@/lib/store';
import { chooseAction, colors, errorMessage, notify } from '@/lib/ui';
import { track } from '@/lib/usage';

const day = (t?: number) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : '');
const BILL_STATUS = { upcoming: 'with your next payment', charged: 'paid', 'not-charged': 'not charged' } as const;

export function ExtraStorage() {
  const [s, setS] = useState<ExtraStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await api.extra());
    } catch {
      setS(null);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!s || !s.available) return null;

  const change = async (capGB: number) => {
    if (busy || capGB === s.capGB) return;
    const raising = capGB > s.capGB;
    if (raising) {
      const max = rupees(capGB * s.paisePerGB);
      const answer = await chooseAction(
        s.capGB ? `Raise the limit to ${capGB} GB?` : `Turn on extra storage, up to ${capGB} GB?`,
        `You pay ${rupees(s.paisePerGB)} per GB a month only for what you keep above ${formatBytes(s.baseBytes)}, measured every day. ` +
          `It's added to your monthly Lens Plus payment, and we tell you the exact amount 3 days before. ` +
          `At most ${max} a month: backups above ${formatBytes(s.baseBytes)} + ${capGB} GB pause instead of costing more. ` +
          `We alert you at 50%, 80% and 100%. Prices include GST.`,
        [{ value: 'yes', label: `Agree · at most ${max} a month` }],
      );
      if (answer !== 'yes') return;
    }
    setBusy(true);
    try {
      setS(await api.setExtra(capGB, raising));
      void refreshStorage();
      track(capGB ? `extra_cap_${capGB}` : 'extra_off');
    } catch (e) {
      notify('Couldn’t change extra storage', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const on = s.capGB > 0;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="add-circle-outline" size={22} color={colors.link} />
        <Text style={styles.title}>Extra storage</Text>
        {on && <Text style={styles.badge}>On</Text>}
      </View>
      <Text style={styles.muted}>
        Keep backing up above {formatBytes(s.baseBytes)}: {rupees(s.paisePerGB)} per GB a month, only for what you keep. You choose the most it can ever cost.
      </Text>

      {!s.ok && !on ? (
        <Text style={styles.muted}>{s.message}</Text>
      ) : (
        <>
          {on && (
            <View style={styles.usage}>
              <Text style={styles.big}>
                {s.extraBytes > 0 ? (
                  <>
                    {formatBytes(s.extraBytes)} <Text style={styles.muted}>of {s.capGB} GB extra in use</Text>
                  </>
                ) : (
                  <Text style={styles.muted}>Nothing above {formatBytes(s.baseBytes)} yet · up to {s.capGB} GB</Text>
                )}
              </Text>
              <View style={styles.bar}>
                <View style={{ width: `${Math.min(100, (s.extraBytes / (s.capGB * 1024 ** 3)) * 100)}%`, backgroundColor: colors.link }} />
              </View>
              <Text style={styles.muted}>
                This month so far {rupees(s.soFarPaise)}
                {s.period?.chargeAt && s.estimatePaise > 0 ? ` · about ${rupees(s.estimatePaise)} with your payment on ${day(s.period.chargeAt)}` : ''} · at most{' '}
                {rupees(s.maxPaise)}
              </Text>
            </View>
          )}
          <Text style={styles.label}>{on ? 'Your limit' : 'Choose your limit'}</Text>
          <View style={styles.options}>
            {s.options.map((gb) => {
              const selected = gb === s.capGB;
              return (
                <Pressable
                  key={gb}
                  style={[styles.option, selected && styles.optionOn, busy && { opacity: 0.6 }]}
                  onPress={() => change(gb)}
                  disabled={busy || (!s.ok && gb > s.capGB)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}>
                  <Text style={styles.optionGb}>+{gb} GB</Text>
                  <Text style={styles.optionMax}>max {rupees(gb * s.paisePerGB)}</Text>
                </Pressable>
              );
            })}
          </View>
          {busy && <ActivityIndicator color="#fff" />}
          {on && (
            <Pressable style={styles.linkButton} onPress={() => change(0)} disabled={busy}>
              <Text style={styles.link}>Turn off extra storage</Text>
            </Pressable>
          )}
          <Text style={styles.fine}>
            Nothing is ever deleted or locked because of a bill: at your limit, new photos wait on your phone. Cancel Lens Plus and the last month&apos;s extra
            storage isn&apos;t charged. To lower the limit or turn it off, first free up space (move photos to your Google Drive, download or delete them).
          </Text>
        </>
      )}

      {s.bills.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={styles.label}>Bills</Text>
          {s.bills.map((b) => (
            <Text key={b.chargeAt} style={styles.muted}>
              {day(b.chargeAt)} · {rupees(b.paise)} · {b.gbMonths} GB-months · {BILL_STATUS[b.status]}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1C1C1E', borderRadius: 20, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1 },
  badge: { color: '#4ADE80', fontSize: 13, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  usage: { gap: 8 },
  big: { color: '#fff', fontSize: 20, fontWeight: '700' },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#2C2C2E', overflow: 'hidden', flexDirection: 'row' },
  label: { color: '#A1A1A6', fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  // 2 × 2: the labels fit on one line from the smallest phones (320 pt) up.
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { flexBasis: '47%', flexGrow: 1, backgroundColor: '#2C2C2E', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, borderWidth: 2, borderColor: '#2C2C2E' },
  optionOn: { borderColor: colors.link },
  optionGb: { color: '#fff', fontSize: 15, fontWeight: '700' },
  optionMax: { color: '#86868B', fontSize: 12 },
  linkButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { color: colors.link, fontSize: 15, fontWeight: '600' },
  fine: { color: '#86868B', fontSize: 12, lineHeight: 17 },
});
