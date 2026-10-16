// Send feedback (Settings → Feedback): rate Lens and write a review, report an
// issue, suggest a feature, or anything else. Stored by the API first, then
// emailed to the team (infra/lambda/api/feedback.ts). The contact email is
// optional (only to get a reply); phone model + app version only with consent.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, FeedbackKind } from '@/lib/api';
import { buildInfo } from '@/lib/build-info';
import { useStore } from '@/lib/store';
import { colors, errorMessage } from '@/lib/ui';

const KINDS: { kind: FeedbackKind; label: string; icon: keyof typeof Ionicons.glyphMap; prompt: string }[] = [
  { kind: 'review', label: 'Rate Lens', icon: 'star-outline', prompt: 'What do you like? What could be better? (optional)' },
  { kind: 'issue', label: 'Report a problem', icon: 'bug-outline', prompt: 'What happened, and what did you expect? Steps to repeat it help a lot.' },
  { kind: 'idea', label: 'Suggest a feature', icon: 'bulb-outline', prompt: 'What would you like Lens to do?' },
  { kind: 'other', label: 'Other', icon: 'chatbubble-ellipses-outline', prompt: 'Tell us anything.' },
];

/** Phone + app details, sent only when the user leaves the switch on. */
function deviceDetails() {
  const c = (Platform.constants ?? {}) as Record<string, unknown>;
  const b = buildInfo();
  return {
    brand: String(c.Brand ?? c.Manufacturer ?? (Platform.OS === 'ios' ? 'Apple' : '')),
    model: String(c.Model ?? (Platform.OS === 'web' ? 'browser' : '')),
    os: Platform.OS,
    osVersion: String(c.Release ?? Platform.Version ?? ''),
    build: b.apk ? `dev-${b.apk}` : '',
    code: b.code ? `dev-${b.code}${b.commit ? ` ${b.commit}` : ''}` : '',
    locale: Intl.DateTimeFormat().resolvedOptions().locale ?? '',
  };
}

export default function FeedbackScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ kind?: string }>();
  const accountEmail = useStore((s) => s.identity?.email ?? '');
  const [kind, setKind] = useState<FeedbackKind>(KINDS.some((k) => k.kind === params.kind) ? (params.kind as FeedbackKind) : 'review');
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [wantReply, setWantReply] = useState(false);
  const [email, setEmail] = useState(accountEmail);
  const [includeDevice, setIncludeDevice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const current = KINDS.find((k) => k.kind === kind)!;
  const canSend = !busy && (kind === 'review' ? rating > 0 : message.trim().length >= 10);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.sendFeedback({
        kind,
        rating: kind === 'review' ? rating : undefined,
        message: message.trim(),
        email: wantReply ? email.trim() : undefined,
        includeDevice,
        device: includeDevice ? deviceDetails() : undefined,
      });
      setSent(r.reference);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  if (sent) {
    return (
      <View style={[styles.fill, styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="checkmark-circle" size={56} color={colors.link} />
        <Text style={styles.thanks}>Thank you!</Text>
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          {wantReply ? 'We read every message and will reply by email.' : 'We read every message.'} Reference {sent}.
        </Text>
        <Pressable style={styles.button} onPress={close} accessibilityRole="button">
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.fill, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>Feedback</Text>
        <Pressable onPress={close} hitSlop={10}>
          <Text style={styles.done}>Cancel</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <View style={styles.kinds}>
          {KINDS.map((k) => (
            <Pressable
              key={k.kind}
              style={[styles.kind, k.kind === kind && styles.kindOn]}
              onPress={() => setKind(k.kind)}
              accessibilityRole="button"
              accessibilityState={{ selected: k.kind === kind }}
            >
              <Ionicons name={k.icon} size={18} color={k.kind === kind ? '#000' : '#fff'} />
              <Text style={[styles.kindText, k.kind === kind && { color: '#000' }]}>{k.label}</Text>
            </Pressable>
          ))}
        </View>

        {kind === 'review' && (
          <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={`Rating ${rating} of 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setRating(n)} hitSlop={6} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
                <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={40} color={n <= rating ? '#FFD60A' : '#636366'} />
              </Pressable>
            ))}
          </View>
        )}

        <TextInput
          style={styles.message}
          value={message}
          onChangeText={setMessage}
          placeholder={current.prompt}
          placeholderTextColor="#636366"
          multiline
          maxLength={4000}
          textAlignVertical="top"
        />

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>I’d like a reply by email</Text>
            <Switch value={wantReply} onValueChange={setWantReply} />
          </View>
          {wantReply && (
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#636366"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Include phone model and app version</Text>
              <Text style={styles.small}>Helps us fix problems on your kind of phone. No photos, no location.</Text>
            </View>
            <Switch value={includeDevice} onValueChange={setIncludeDevice} />
          </View>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={[styles.button, !canSend && { opacity: 0.4 }]} disabled={!canSend} onPress={send} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send</Text>}
        </Pressable>
        <Text style={[styles.small, { textAlign: 'center' }]}>Stored securely with your Lens account and read by the Lens team. Privacy policy: lens.instagrowapp.com/privacy</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 56 },
  title: { color: '#fff', fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  done: { color: colors.link, fontSize: 17, fontWeight: '600' },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: '#1c1c1e' },
  kindOn: { backgroundColor: '#fff' },
  kindText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 4 },
  message: { minHeight: 140, backgroundColor: '#1c1c1e', borderRadius: 14, padding: 14, color: '#fff', fontSize: 16 },
  card: { backgroundColor: '#1c1c1e', borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8 },
  rowLabel: { color: '#fff', fontSize: 16, flex: 1 },
  small: { color: '#8e8e93', fontSize: 13, marginTop: 2 },
  input: { backgroundColor: '#2c2c2e', borderRadius: 10, padding: 12, color: '#fff', fontSize: 16, marginBottom: 10 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#38383a' },
  error: { color: '#ff453a', fontSize: 15, textAlign: 'center' },
  button: { backgroundColor: colors.link, borderRadius: 14, paddingVertical: 15, alignItems: 'center', alignSelf: 'stretch' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  thanks: { color: '#fff', fontSize: 28, fontWeight: '700' },
  muted: { color: '#8e8e93', fontSize: 15 },
});
