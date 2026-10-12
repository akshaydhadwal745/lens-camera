// A QR code drawn with plain views (uqr makes the matrix; no native module).
import { useMemo } from 'react';
import { View } from 'react-native';
import { encode } from 'uqr';

export function QrCode({ value, size }: { value: string; size: number }) {
  const { data } = useMemo(() => encode(value, { border: 2 }), [value]);
  const cell = size / data.length;
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff' }} accessibilityLabel="QR code">
      {data.map((row, y) => (
        <View key={y} style={{ flexDirection: 'row', height: cell }}>
          {row.map((on, x) => (
            <View key={x} style={{ width: cell, height: cell, backgroundColor: on ? '#000' : '#fff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}
