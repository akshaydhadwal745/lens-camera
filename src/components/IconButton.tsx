import { Ionicons } from '@expo/vector-icons';
import { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';

type Props = {
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  label?: string;
  active?: boolean;
  size?: number;
  disabled?: boolean;
  accessibilityLabel: string;
};

export function IconButton({ icon, onPress, label, active, size = 24, disabled, accessibilityLabel }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.inner}>
        <Ionicons name={icon} size={size} color={active ? '#FACC15' : '#fff'} />
        {label ? <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    paddingHorizontal: 6,
  },
  inner: { alignItems: 'center' },
  pressed: { opacity: 0.5 },
  disabled: { opacity: 0.3 },
  label: { color: '#fff', fontSize: 10, fontWeight: '600', marginTop: 2 },
  activeLabel: { color: '#FACC15' },
});
