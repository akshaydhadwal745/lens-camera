// Lens Plus (docs/business/payments.md): the "Lock in Lens Plus" offer during the welcome (₹0 today,
// first charge when the welcome ends), or Lens Plus now after it; status and one-tap cancel.
// Payment happens on Razorpay's own page (UPI Autopay / card); we only learn the result.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExtraStorage } from '@/components/ExtraStorage';
import { Text } from '@/components/ui/Text';
import { api, PlusKind, PlusStatus } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { razorpayHere, rupees } from '@/lib/pay-channel';
import { markPlusNever } from '@/lib/plus-prompt';
import { refreshStorage } from '@/lib/store';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';
import { track } from '@/lib/usage';

const day = (t?: number) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');

function Benefit({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.benefit}>
      <Ionicons name={icon} size={20} color={colors.link} />
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

export default function PlusScreen() {
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [status, setStatus] = useState<PlusStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<PlusKind>('plus50-month');
  const [busy, setBusy] = useState(false);
  const waiting = useRef(false);

  const load = useCallback(async (refresh = false) => {
    try {
      const s = refresh ? await api.plusRefresh() : await api.plus();
      setStatus(s);
      setError(null);
      if (refresh && (s.subscription?.status === 'scheduled' || s.subscription?.status === 'active')) {
        waiting.current = false;
        void refreshStorage();
      }
      return s;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    track(`plus_open_${from ?? 'settings'}`);
    return () => clearTimeout(t);
  }, [load, from]);

  // Back from Razorpay's page (browser tab closed / app in front again): ask Razorpay where it stands.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && waiting.current) void load(true);
    });
    return () => sub.remove();
  }, [load]);

  const pay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { url } = await api.plusCheckout(kind);
      waiting.current = true;
      track(`plus_checkout_${kind}`);
      if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
      else {
        await WebBrowser.openBrowserAsync(url, { showTitle: true, enableBarCollapsing: true });
        await load(true);
      }
    } catch (e) {
      notify('Couldn’t start the payment', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const sub = status?.subscription;
    const started = sub?.status === 'active';
    const ok = await confirmDestructive(
      'Cancel Lens Plus?',
      started
        ? `Lens Plus keeps working until ${day(status?.plan?.periodEnd)}, then you go back to free storage. Nothing is deleted.`
        : 'Nothing will be charged. Your welcome storage continues as before.',
      'Cancel Lens Plus',
    );
    if (!ok) return;
    setBusy(true);
    try {
      setStatus(await api.plusCancel());
      void refreshStorage();
      track('plus_cancelled');
    } catch (e) {
      notify('Couldn’t cancel', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const notNow = (never = false) => {
    if (never) markPlusNever();
    track(never ? 'plus_never' : 'plus_not_now');
    router.back();
  };

  const offer = status?.offer;
  const sub = status?.subscription;
  const plan = status?.plan;
  const chosen = offer ? (kind === 'plus50-month' ? offer.monthly : offer.yearly) : null;
  const lockIn = !!offer?.startsAt;
  const intro = chosen && chosen.firstPaise !== chosen.paise;
  const per = kind === 'plus50-month' ? 'month' : 'year';

  let body;
  if (!status) {
    body = error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color="#fff" style={{ padding: 32 }} />;
  } else if (!status.signedIn) {
    body = (
      <Pressable style={styles.button} onPress={() => router.replace('/signin')}>
        <Text style={styles.buttonText}>Sign in first</Text>
      </Pressable>
    );
  } else if (sub?.status === 'scheduled' || sub?.status === 'active' || (plan && plan.provider !== 'razorpay')) {
    const scheduled = sub?.status === 'scheduled';
    body = (
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={22} color="#4ADE80" />
          <Text style={styles.cardTitle}>{scheduled ? 'Lens Plus is locked in' : (plan?.name ?? 'Lens Plus')}</Text>
        </View>
        <Text style={styles.muted}>
          {scheduled
            ? `Nothing charged yet. It starts on ${day(sub!.chargeAt)} when your welcome ends: ${rupees(sub!.firstPaise)}${sub!.firstPaise !== sub!.paise ? `, then ${rupees(sub!.paise)} a ${sub!.period}` : ` a ${sub!.period}`}. We remind you 3 days before.`
            : plan?.cancelled || sub?.cancelled
              ? `Cancelled. Works until ${day(plan?.periodEnd)}, then free storage. Nothing is deleted.`
              : plan?.status === 'grace'
                ? 'The last payment didn’t go through. Razorpay tries again; you keep Plus meanwhile.'
                : `Renews on ${day(plan?.periodEnd)}${sub ? ` · ${rupees(sub.paise)} a ${sub.period}` : ''}.`}
        </Text>
        {sub && !sub.cancelled && !plan?.cancelled && (
          <Pressable style={[styles.smallButton, styles.dangerButton]} onPress={cancel} disabled={busy}>
            <Text style={[styles.smallButtonText, { color: colors.danger }]}>Cancel Lens Plus</Text>
          </Pressable>
        )}
      </View>
    );
    // Extra storage above 50 GB: only for a running Lens Plus paid through Razorpay.
    if (razorpayHere && sub?.status === 'active' && plan?.provider === 'razorpay')
      body = (
        <>
          {body}
          <ExtraStorage />
        </>
      );
  } else if (!razorpayHere || !status.available) {
    body = (
      <Text style={styles.muted}>
        {Platform.OS === 'ios' ? 'Lens Plus on iPhone is coming soon.' : 'Lens Plus is coming to this version of the app soon.'} Your storage and
        backups keep working as they are.
      </Text>
    );
  } else {
    body = (
      <>
        <View style={styles.choices}>
          {(['plus50-month', 'plus50-year'] as const).map((k) => {
            const o = k === 'plus50-month' ? offer!.monthly : offer!.yearly;
            const on = kind === k;
            return (
              <Pressable key={k} style={[styles.choice, on && styles.choiceOn]} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Text style={styles.choiceName}>{k === 'plus50-month' ? 'Monthly' : 'Yearly'}</Text>
                <Text style={styles.choicePrice}>
                  {rupees(o.paise)}
                  <Text style={styles.muted}>{k === 'plus50-month' ? ' / month' : ' / year'}</Text>
                </Text>
                <Text style={styles.choiceNote}>
                  {o.firstPaise !== o.paise ? `First month ${rupees(o.firstPaise)}` : k === 'plus50-year' ? `${rupees(Math.round(o.paise / 12))} a month · save 30%` : 'Cancel any time'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={[styles.button, busy && { opacity: 0.6 }]} onPress={pay} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{lockIn ? 'Lock in for ₹0 today' : `Get Lens Plus · ${rupees(chosen!.firstPaise)}`}</Text>}
        </Pressable>
        <Text style={styles.fine}>
          {lockIn
            ? `Nothing is charged today. Your 40 GB welcome continues until ${day(offer!.startsAt)}; then Lens Plus starts at ${rupees(chosen!.firstPaise)}${intro ? ` for the first month, then ${rupees(chosen!.paise)} a ${per}` : ` a ${per}`}. `
            : `${rupees(chosen!.firstPaise)} today, then every ${per}. `}
          Pay with UPI Autopay or a card on Razorpay’s secure page (your bank may show a small check that’s refunded). Razorpay notifies you before every charge
          {lockIn ? ', and we remind you 3 days before the first' : ''}. Cancel in one tap here, any time. Prices include GST.
        </Text>
        {sub?.status === 'created' && (
          <Pressable style={styles.linkButton} onPress={() => load(true)}>
            <Text style={styles.link}>Already paid? Check again</Text>
          </Pressable>
        )}
        <Pressable style={styles.linkButton} onPress={() => notNow(false)}>
          <Text style={styles.link}>Not now</Text>
        </Pressable>
        {from && from !== 'settings' && (
          <Pressable style={styles.linkButton} onPress={() => notNow(true)}>
            <Text style={[styles.link, { color: colors.muted }]}>Don’t show this again</Text>
          </Pressable>
        )}
      </>
    );
  }

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Lens Plus</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: insets.bottom + 32, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        {status?.testMode && (
          <View style={styles.test}>
            <Ionicons name="flask-outline" size={16} color="#FACC15" />
            <Text style={styles.testText}>Test mode: no real money is charged.</Text>
          </View>
        )}
        <Text style={styles.hero}>{formatBytes(offer?.bytes ?? 50 * 1024 ** 3)} for every photo and video, in full quality.</Text>
        <View style={{ gap: 12 }}>
          <Benefit icon="cloud-upload-outline" text="Backups never pause: no choosing what to keep." />
          <Benefit icon="images-outline" text="Originals in full quality, previews instant on every device." />
          <Benefit icon="shield-checkmark-outline" text="Deleted by mistake? Recover anything for a year." />
          <Benefit icon="heart-outline" text="Keeps Lens free of ads and independent." />
        </View>
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 56 },
  title: { color: '#fff', fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  done: { color: colors.link, fontSize: 17, fontWeight: '600' },
  hero: { color: '#fff', fontSize: 24, fontWeight: '700', lineHeight: 30, letterSpacing: -0.4 },
  benefit: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  benefitText: { color: '#E8E8ED', fontSize: 15, flex: 1, lineHeight: 20 },
  test: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#2A2410', borderRadius: 10, padding: 10 },
  testText: { color: '#FACC15', fontSize: 13, fontWeight: '600' },
  choices: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, backgroundColor: '#1C1C1E', borderRadius: 16, padding: 14, gap: 4, borderWidth: 2, borderColor: '#1C1C1E' },
  choiceOn: { borderColor: colors.link },
  choiceName: { color: '#A1A1A6', fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  choicePrice: { color: '#fff', fontSize: 22, fontWeight: '700' },
  choiceNote: { color: '#4ADE80', fontSize: 12, fontWeight: '600' },
  button: { backgroundColor: colors.action, borderRadius: 980, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  fine: { color: '#86868B', fontSize: 12, lineHeight: 17 },
  linkButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  link: { color: colors.link, fontSize: 15, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: '#1C1C1E', borderRadius: 20, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  smallButton: { backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start' },
  dangerButton: { backgroundColor: '#2A1515' },
  smallButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
