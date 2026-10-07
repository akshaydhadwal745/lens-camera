import { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Bottom sheet over the camera. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 8 }}>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Pressable style={styles.row} onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.choice}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[styles.chip, value === o.value && styles.chipOn]}>
            <Text style={[styles.chipText, value === o.value && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#141416',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  done: { color: '#FACC15', fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, minHeight: 50 },
  label: { color: '#fff', fontSize: 15 },
  hint: { color: '#888', fontSize: 12, marginTop: 2 },
  switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: '#3A3A3C', padding: 3 },
  switchOn: { backgroundColor: '#FACC15' },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  knobOn: { transform: [{ translateX: 18 }], backgroundColor: '#000' },
  choice: { paddingHorizontal: 18, paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: '#2C2C2E' },
  chipOn: { backgroundColor: '#FACC15' },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#000' },
});
