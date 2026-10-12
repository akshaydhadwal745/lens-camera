// Lens's own message banner (replaces the system alert box for notify()):
// dark glass at the top, an icon for success / problem, closes itself or on tap.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { onToast, ToastMessage } from '@/lib/ui';

/** Long enough to read: 3 s plus reading time, at most 9 s. */
function duration(m: ToastMessage): number {
  return Math.min(9000, 3000 + (m.title.length + (m.message?.length ?? 0)) * 45);
}

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<ToastMessage | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hide = () =>
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => finished && setCurrent(null));
    const unsubscribe = onToast((m) => {
      if (timer.current) clearTimeout(timer.current);
      setCurrent(m);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
      timer.current = setTimeout(hide, duration(m));
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [anim]);

  if (!current) return null;
  const problem = current.tone === 'problem';
  const dismiss = () => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(anim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setCurrent(null));
  };
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 10 }]}>
      <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }], width: '100%', maxWidth: 520 }}>
        <Pressable onPress={dismiss} style={styles.card} accessibilityRole="alert" accessibilityLabel={`${current.title}. ${current.message ?? ''}`}>
          <View style={[styles.icon, { backgroundColor: problem ? 'rgba(255,69,58,0.18)' : 'rgba(48,209,88,0.18)' }]}>
            <Ionicons name={problem ? 'alert' : 'checkmark'} size={18} color={problem ? '#FF453A' : '#30D158'} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{current.title}</Text>
            {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 1000, elevation: 1000 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 15, fontWeight: '600' },
  message: { color: '#C7C7CC', fontSize: 13, lineHeight: 18, marginTop: 2 },
});
