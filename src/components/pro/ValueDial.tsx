import * as Haptics from 'expo-haptics';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { font } from '@/lib/theme';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const SPACING = 12;
const VISIBLE = 32;

type Props = {
  title: string;
  values: number[];
  index: number;
  label: (value: number) => string;
  onIndex: (index: number) => void;
  auto: boolean;
  onAuto: () => void;
  /** Value to show while in auto (what the camera is doing right now). */
  autoLabel?: string;
  /** Text of the reset button (default AUTO). */
  autoText?: string;
};

/** Horizontal ruler: drag to step through values, tap AUTO to hand back control. */
export function ValueDial({ title, values, index, label, onIndex, auto, onAuto, autoLabel, autoText = 'AUTO' }: Props) {
  const [width, setWidth] = useState(0);
  const indexRef = useRef(index);
  const startRef = useRef(index);
  const onIndexRef = useRef(onIndex);
  const valuesRef = useRef(values);
  indexRef.current = index;
  onIndexRef.current = onIndex;
  valuesRef.current = values;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-6, 6])
        .onStart(() => {
          startRef.current = indexRef.current;
        })
        .onUpdate((e) => {
          const max = valuesRef.current.length - 1;
          const next = Math.max(0, Math.min(max, Math.round(startRef.current - e.translationX / SPACING)));
          if (next !== indexRef.current) {
            indexRef.current = next;
            onIndexRef.current(next);
            Haptics.selectionAsync().catch(() => {});
          }
        }),
    [],
  );

  const ticks = [];
  for (let i = Math.max(0, index - VISIBLE); i <= Math.min(values.length - 1, index + VISIBLE); i++) {
    const x = width / 2 + (i - index) * SPACING;
    const major = i % 5 === 0;
    ticks.push(
      <View
        key={i}
        style={[styles.tick, { left: x, height: major ? 18 : 10, opacity: Math.max(0.15, 1 - Math.abs(i - index) / VISIBLE) }]}
      />,
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={[styles.value, auto && styles.valueAuto]}>{auto ? (autoLabel ?? 'AUTO') : label(values[index])}</Text>
        <Pressable onPress={onAuto} style={[styles.auto, auto && styles.autoOn]} hitSlop={8} accessibilityLabel={`${title} ${autoText.toLowerCase()}`}>
          <Text style={[styles.autoText, auto && styles.autoTextOn]}>{autoText}</Text>
        </Pressable>
      </View>
      <GestureDetector gesture={pan}>
        <View style={styles.ruler} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="adjustable">
          {ticks}
          <View style={[styles.center, { left: width / 2 - 1 }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#A1A1A6', fontSize: 11, fontFamily: font.monoMedium, letterSpacing: 1, width: 70 },
  value: { color: '#FACC15', fontSize: 18, fontFamily: font.monoSemibold, fontVariant: ['tabular-nums'] },
  valueAuto: { color: '#fff' },
  auto: { width: 70, alignItems: 'flex-end' },
  autoOn: {},
  autoText: { color: '#86868B', fontSize: 11, fontFamily: font.monoSemibold, letterSpacing: 1, borderWidth: 1, borderColor: '#636366', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  autoTextOn: { color: '#000', backgroundColor: '#FACC15', borderColor: '#FACC15', overflow: 'hidden' },
  ruler: { height: 34, justifyContent: 'center', overflow: 'hidden' },
  tick: { position: 'absolute', width: 1.5, backgroundColor: '#fff', top: 8 },
  center: { position: 'absolute', width: 2, top: 2, bottom: 2, backgroundColor: '#FACC15', borderRadius: 1 },
});
