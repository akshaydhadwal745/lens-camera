// The roll's feedback card (src/lib/review-prompt.ts decides when): "How's Lens
// so far?" with stars, or "What's one thing Lens is missing?". Answers open the
// feedback form (src/app/feedback.tsx) pre-filled; nothing is sent until Send. 4–5 stars open
// Google Play's in-app review instead (when the app came from Play).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';

import { markMissingAnswered, markNeverAsk, markPromptShown, markRated, PromptKind } from '@/lib/review-prompt';
import { palette } from '@/lib/theme';
import { track } from '@/lib/usage';
import { playReview } from '../../modules/lens-device';

export function FeedbackPrompt({ kind, onClose }: { kind: PromptKind; onClose: () => void }) {
  useEffect(() => markPromptShown(), []);

  const rate = async (stars: number) => {
    markRated(stars);
    onClose();
    track(`rated_${stars}`);
    // Happy: Google Play's own review card (ratings decide how Lens ranks on Play). Not happy, or
    // not installed from Play: our feedback form, so we can fix what's wrong.
    if (stars >= 4 && playReview && (await playReview.request().catch(() => false))) return;
    router.push(`/feedback?kind=review&rating=${stars}&source=prompt` as never);
  };
  const missing = () => {
    markMissingAnswered();
    onClose();
    router.push('/feedback?kind=idea&source=prompt-missing' as never);
  };
  const never = () => {
    markNeverAsk();
    onClose();
  };

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.title}>{kind === 'rate' ? 'How’s Lens so far?' : 'What’s one thing Lens is missing?'}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Not now">
          <Ionicons name="close" size={16} color="#86868B" />
        </Pressable>
      </View>
      {kind === 'rate' ? (
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => rate(n)} hitSlop={6} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
              <Ionicons name="star-outline" size={30} color="#FFD60A" />
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable style={styles.button} onPress={missing} accessibilityRole="button">
          <Text style={styles.buttonText}>Tell us</Text>
        </Pressable>
      )}
      <View style={styles.bottom}>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.link}>Not now</Text>
        </Pressable>
        <Pressable onPress={never} hitSlop={8}>
          <Text style={styles.link}>Don’t ask again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 8, marginBottom: 4, padding: 14, borderRadius: 16, backgroundColor: palette.surface, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: palette.text, fontSize: 15, fontWeight: '600', flex: 1 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  button: { alignSelf: 'center', backgroundColor: palette.link, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 28 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  bottom: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { color: '#86868B', fontSize: 13 },
});
