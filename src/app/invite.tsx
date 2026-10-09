// Invite friends: share your link, earn Lens storage when a friend signs in on
// their phone. Also "I have a code" for people who joined in the last 7 days.
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Referrals } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { colors, errorMessage, notify } from '@/lib/ui';

const STATE_TEXT: Record<Referrals['friends'][number]['state'], string> = {
  joined: 'Installed: waiting for sign-in',
  'signed-in': 'Signed in',
  rewarded: 'Storage added',
  'not-eligible': 'Not eligible',
};

export default function InviteScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Referrals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(() => {
    api.referrals().then(setData, (e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const share = async () => {
    if (!data) return;
    await Share.share({
      message: `I back up my photos with Lens: full quality, private, free. Get it here: ${data.link}`,
    }).catch(() => undefined);
  };
  const copy = async () => {
    if (!data) return;
    await Clipboard.setStringAsync(data.link);
    notify('Link copied', data.link);
  };
  const claim = async () => {
    setClaiming(true);
    try {
      await api.claimReferral(code.trim());
      notify('Code added', 'Thanks! Your friend gets their storage once everything checks out.');
      setCode('');
      load();
    } catch (e) {
      notify('Could not add the code', errorMessage(e));
    } finally {
      setClaiming(false);
    }
  };

  const reward = data ? formatBytes(data.rewardBytes) : '10 GB';
  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Invite friends</Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {error ? (
          <View style={styles.hero}>
            <Ionicons name="gift-outline" size={44} color={colors.accent} />
            <Text style={styles.heroTitle}>Get +10 GB for every friend</Text>
            <Text style={styles.muted}>{error}</Text>
            {/sign in/i.test(error) && (
              <Pressable style={styles.button} onPress={() => router.replace('/signin')}>
                <Text style={styles.buttonText}>Sign in</Text>
              </Pressable>
            )}
          </View>
        ) : !data ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
        ) : (
          <>
            <View style={styles.hero}>
              <Ionicons name="gift-outline" size={44} color={colors.accent} />
              <Text style={styles.heroTitle}>+{reward} for every friend</Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                Share your link. When a friend installs Lens and signs in on their phone, you get {reward} more storage, for good.
                {data.friendBonusBytes > 0 ? ` They get ${formatBytes(data.friendBonusBytes)} too.` : ''} No limit.
              </Text>
              <Text style={styles.codeText} selectable>
                {data.code}
              </Text>
              <View style={styles.buttons}>
                <Pressable style={[styles.button, { flex: 1 }]} onPress={share} accessibilityRole="button">
                  <Ionicons name="share-outline" size={18} color="#000" />
                  <Text style={styles.buttonText}>Share link</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.secondary, { flex: 1 }]} onPress={copy} accessibilityRole="button">
                  <Ionicons name="copy-outline" size={18} color="#fff" />
                  <Text style={[styles.buttonText, { color: '#fff' }]}>Copy</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Your rewards</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Storage earned</Text>
                <Text style={styles.rowValue}>{formatBytes(data.earnedBytes)}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Friends joined</Text>
                <Text style={styles.rowValue}>{data.friends.length}</Text>
              </View>
            </View>

            {data.friends.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Friends</Text>
                <View style={styles.card}>
                  {data.friends.map((f, i) => (
                    <View key={`${f.name}-${f.at}`}>
                      {i > 0 && <View style={styles.divider} />}
                      <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowLabel}>{f.name}</Text>
                          <Text style={styles.small}>{STATE_TEXT[f.state]}</Text>
                        </View>
                        {f.bytes > 0 && <Text style={[styles.rowValue, { color: colors.accent }]}>+{formatBytes(f.bytes)}</Text>}
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}

            {data.canClaim && (
              <>
                <Text style={styles.sectionTitle}>Got a code from a friend?</Text>
                <View style={[styles.card, { padding: 12, flexDirection: 'row', gap: 8 }]}>
                  <TextInput
                    style={styles.input}
                    value={code}
                    onChangeText={setCode}
                    placeholder="Friend’s code"
                    placeholderTextColor="#666"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                  />
                  <Pressable style={[styles.button, { margin: 0, paddingHorizontal: 16 }]} onPress={claim} disabled={claiming || code.trim().length < 6}>
                    {claiming ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Add</Text>}
                  </Pressable>
                </View>
                <Text style={styles.footer}>You can add a code within 7 days of joining.</Text>
              </>
            )}

            <Text style={styles.footer}>
              Rewards are for real friends: each person and each phone counts once, and your own accounts or phones don’t count. Unusual
              activity is reviewed before storage is added. Bonus storage stays as long as your account exists.
            </Text>
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
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  small: { color: colors.muted, fontSize: 12, marginTop: 2 },
  codeText: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 4, marginTop: 8, fontVariant: ['tabular-nums'] },
  buttons: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    marginTop: 12,
    borderRadius: 12,
    minHeight: 46,
  },
  secondary: { backgroundColor: '#2C2C2E' },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 15 },
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 20, marginBottom: 8, marginLeft: 20 },
  card: { backgroundColor: '#1C1C1E', borderRadius: 14, overflow: 'hidden', marginHorizontal: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, minHeight: 52, gap: 8 },
  rowLabel: { color: '#fff', fontSize: 15 },
  rowValue: { color: colors.muted, fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#333', marginLeft: 16 },
  input: { flex: 1, color: '#fff', fontSize: 17, backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 12, minHeight: 46, letterSpacing: 2 },
  footer: { color: '#777', fontSize: 12, marginTop: 10, marginHorizontal: 20, lineHeight: 17 },
});
