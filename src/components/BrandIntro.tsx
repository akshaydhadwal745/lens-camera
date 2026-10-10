import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';
import { Text } from '@/components/ui/Text';

const mark = require('../../assets/splash-icon.png');
const useNativeDriver = Platform.OS !== 'web';

/** Logo intro shown over the app while it boots, then fades away. */
export function BrandIntro({ done, onFinished }: { done: boolean; onFinished: () => void }) {
  const scale = useRef(new Animated.Value(0.82)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(1)).current;
  const minTimeReached = useRef(false);
  const doneRef = useRef(done);
  doneRef.current = done;

  const finish = () => {
    Animated.timing(overlay, { toValue: 0, duration: 280, useNativeDriver }).start(onFinished);
  };

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 60, useNativeDriver }),
      Animated.sequence([
        Animated.delay(250),
        Animated.parallel([
          Animated.timing(lift, { toValue: -18, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver }),
          Animated.timing(titleOpacity, { toValue: 1, duration: 380, useNativeDriver }),
        ]),
      ]),
    ]).start();
    const timer = setTimeout(() => {
      minTimeReached.current = true;
      if (doneRef.current) finish();
    }, 1100);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (done && minTimeReached.current) finish();
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: overlay }]} pointerEvents="none">
      <Animated.View style={{ transform: [{ translateY: lift }, { scale }] }}>
        <Image source={mark} style={styles.mark} contentFit="contain" />
      </Animated.View>
      <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: lift }] }}>
        <Text style={styles.title}>Lens</Text>
        <Text style={styles.tagline}>Shoot here. Safe in the cloud.</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0B1020', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  mark: { width: 200, height: 200 },
  // Matches the native splash background (app.json) so there's no flash; the type is the Keynote wordmark.
  title: { color: '#F5F5F7', fontSize: 40, fontWeight: '700', letterSpacing: -1.5, textAlign: 'center', marginTop: -16 },
  tagline: { color: '#A1A1A6', fontSize: 15, textAlign: 'center', marginTop: 6 },
});
