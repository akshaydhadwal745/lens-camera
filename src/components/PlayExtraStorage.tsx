// Extra storage in the Play Store app (docs/design/play-billing.md): the person picks how much to add
// above Lens Plus, a quick pick or any amount from 4 to 100 GB, and Google Play bills GB × ₹3 a
// month as a subscription next to Lens Plus. Changing the amount is a Play plan change (Google
// prorates it); turning it off is cancelling it in Google Play.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { Text, TextInput } from '@/components/ui/Text';
import { api, ExtraStatus, PlayStatus } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { buyExtra, extraPrices, manageUrl, type ExtraPrice } from '@/lib/play-billing';
import { refreshStorage } from '@/lib/store';
import { chooseAction, colors, errorMessage, notify } from '@/lib/ui';
import { track } from '@/lib/usage';

const QUICK = [10, 20, 50, 100];

export function PlayExtraStorage({ status, onChange }: { status: PlayStatus; onChange: () => Promise<void> }) {
  const [prices, setPrices] = useState<ExtraPrice[] | null>(null);
  const [usage, setUsage] = useState<ExtraStatus | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = status.extra.capGB;

  const load = useCallback(async () => {
    try {
      const [p, u] = await Promise.all([extraPrices(), api.extra().catch(() => null)]);
      setPrices(p);
      setUsage(u);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return null; // Play not reachable: Lens Plus still shows; nothing to sell here
  if (!prices) return <ActivityIndicator color="#fff" />;
  if (!prices.length) return null;

  const min = prices[0].gb;
  const max = prices[prices.length - 1].gb;
  const typed = Number(amount);
  const typedPrice = Number.isInteger(typed) ? prices.find((p) => p.gb === typed) : undefined;
  const keptAbove = usage?.extraBytes ?? 0;

  const choose = async (gb: number) => {
    const price = prices.find((p) => p.gb === gb);
    if (busy || !price || gb === current) return;
    if (gb * 1024 ** 3 < keptAbove) {
      notify('Free up space first', `You keep ${formatBytes(keptAbove)} above Lens Plus, more than ${gb} GB. Move photos to your Google Drive, download or delete some, then choose a smaller amount.`);
      return;
    }
    const answer = await chooseAction(
      current ? `Change extra storage to ${gb} GB?` : `Add ${gb} GB of extra storage?`,
      `${price.price} a month through Google Play, on top of Lens Plus (₹3 per GB). ${current ? 'Google adjusts this month’s charge for the change. ' : ''}Renews monthly until you cancel it in Google Play. Prices include GST.`,
      [{ value: 'yes', label: `${current ? 'Change' : 'Add'} · ${price.price} a month` }],
    );
    if (answer !== 'yes') return;
    setBusy(true);
    try {
      track(`extra_play_${gb}`);
      await buyExtra(price, status);
      setAmount('');
      await onChange();
      void refreshStorage();
    } catch (e) {
      if (!(e as { cancelled?: boolean }).cancelled) notify('Couldn’t change extra storage', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="add-circle-outline" size={22} color={colors.link} />
        <Text style={styles.title}>Extra storage</Text>
        {current > 0 && <Text style={styles.badge}>+{current} GB</Text>}
      </View>
      <Text style={styles.muted}>
        {current
          ? `You have ${current} GB extra above Lens Plus${keptAbove ? `, ${formatBytes(keptAbove)} in use` : ''}. Change the amount any time.`
          : 'Need more than 50 GB? Add exactly what you need: ₹3 per GB a month.'}
      </Text>
      <Text style={styles.label}>Quick pick</Text>
      <View style={styles.options}>
        {QUICK.filter((gb) => gb >= min && gb <= max).map((gb) => {
          const p = prices.find((x) => x.gb === gb);
          const on = gb === current;
          return (
            <Pressable
              key={gb}
              style={[styles.option, on && styles.optionOn, busy && { opacity: 0.6 }]}
              onPress={() => void choose(gb)}
              disabled={busy || !p}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}>
              <Text style={styles.optionGb}>+{gb} GB</Text>
              <Text style={styles.optionMax}>{p?.price ?? ''} a month</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>Or your own amount</Text>
      <View style={styles.customRow}>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, '').slice(0, 3))}
          keyboardType="number-pad"
          placeholder={`${min}–${max}`}
          placeholderTextColor="#636366"
          accessibilityLabel="Extra storage in GB"
          returnKeyType="done"
        />
        <Text style={styles.unit}>GB</Text>
        <Pressable
          style={[styles.addButton, (!typedPrice || busy) && { opacity: 0.5 }]}
          onPress={() => typedPrice && void choose(typedPrice.gb)}
          disabled={!typedPrice || busy}
          accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.addText}>{typedPrice ? `${typedPrice.price} a month` : 'Choose'}</Text>}
        </Pressable>
      </View>
      {amount !== '' && !typedPrice && <Text style={styles.hint}>Choose a whole number from {min} to {max} GB.</Text>}
      {current > 0 && (
        <Pressable style={styles.linkButton} onPress={() => void Linking.openURL(manageUrl(current <= 50 ? 'lens_extra_a' : 'lens_extra_b'))}>
          <Text style={styles.link}>Turn off in Google Play</Text>
        </Pressable>
      )}
      <Text style={styles.fine}>
        Nothing is ever deleted because of a bill: if extra storage ends while you keep more than Lens Plus holds, new photos wait on your phone until you free up space or
        add storage again.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1C1C1E', borderRadius: 20, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1 },
  badge: { color: '#4ADE80', fontSize: 13, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  label: { color: '#A1A1A6', fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  // 2 × 2: the labels fit on one line from the smallest phones (320 pt) up.
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { flexBasis: '47%', flexGrow: 1, backgroundColor: '#2C2C2E', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, borderWidth: 2, borderColor: '#2C2C2E' },
  optionOn: { borderColor: colors.link },
  optionGb: { color: '#fff', fontSize: 15, fontWeight: '700' },
  optionMax: { color: '#86868B', fontSize: 12 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { width: 80, minHeight: 44, backgroundColor: '#2C2C2E', borderRadius: 12, color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  unit: { color: '#A1A1A6', fontSize: 15, fontWeight: '600' },
  addButton: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  addText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hint: { color: '#FACC15', fontSize: 12 },
  linkButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { color: colors.link, fontSize: 15, fontWeight: '600' },
  fine: { color: '#86868B', fontSize: 12, lineHeight: 17 },
});
