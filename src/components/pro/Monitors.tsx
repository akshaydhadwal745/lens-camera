import { Accelerometer } from 'expo-sensors';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AnalysisResult } from '../../../modules/lens-camera';
import type { Grid, Guide } from '@/lib/pro-camera';

/** Live luma histogram with clipping warnings. */
export const Histogram = memo(function Histogram({ data }: { data: AnalysisResult | null }) {
  const bins = data?.histogram ?? [];
  const highWarn = (data?.clipHigh ?? 0) > 0.02;
  const lowWarn = (data?.clipLow ?? 0) > 0.05;
  return (
    <View style={styles.histogram} pointerEvents="none">
      <View style={styles.bars}>
        {bins.map((v, i) => (
          <View key={i} style={[styles.bar, { height: `${Math.max(2, v * 100)}%` }]} />
        ))}
      </View>
      <View style={styles.clipRow}>
        <View style={[styles.clip, lowWarn && { backgroundColor: '#3B82F6' }]} />
        <View style={[styles.clip, highWarn && { backgroundColor: '#EF4444' }]} />
      </View>
    </View>
  );
});

/** Horizon level from the accelerometer (portrait orientation). */
export function LevelIndicator() {
  const [roll, setRoll] = useState(0);
  const [flat, setFlat] = useState(false);

  useEffect(() => {
    Accelerometer.setUpdateInterval(60);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      // When the phone lies flat, roll is meaningless.
      setFlat(Math.abs(z) > 0.85);
      setRoll((Math.atan2(x, -y) * 180) / Math.PI);
    });
    return () => sub.remove();
  }, []);

  if (flat) return null;
  // Snap to the nearest right angle so it also works in landscape.
  const nearest = Math.round(roll / 90) * 90;
  const offset = roll - nearest;
  const level = Math.abs(offset) < 1;
  return (
    <View style={styles.levelWrap} pointerEvents="none">
      <View style={[styles.levelSide, level && styles.levelOn]} />
      <View style={[styles.levelLine, level && styles.levelOn, { transform: [{ rotate: `${-offset}deg` }] }]} />
      <View style={[styles.levelSide, level && styles.levelOn]} />
      {!level && <Text style={styles.levelText}>{offset.toFixed(0)}°</Text>}
    </View>
  );
}

/** Composition grid + aspect-ratio crop guide. */
export function Framing({ grid, guide, width, height }: { grid: Grid; guide: Guide; width: number; height: number }) {
  let rect = { x: 0, y: 0, w: width, h: height };
  if (guide !== 'off' && width > 0 && height > 0) {
    const [a, b] = guide.split(':').map(Number);
    // Long side of the guide runs along the long side of the screen.
    const ratio = Math.max(a, b) / Math.min(a, b);
    const portrait = height >= width;
    const longIsHeight = a >= b ? portrait : !portrait;
    let w = width;
    let h = height;
    if (longIsHeight) {
      h = Math.min(height, width * ratio);
      w = h / ratio;
    } else {
      w = Math.min(width, height * ratio);
      h = w / ratio;
    }
    rect = { x: (width - w) / 2, y: (height - h) / 2, w, h };
  }

  const lines = [];
  if (grid === 'thirds') {
    for (const f of [1 / 3, 2 / 3]) {
      lines.push(<View key={`v${f}`} style={[styles.line, { left: rect.x + rect.w * f, top: rect.y, height: rect.h, width: StyleSheet.hairlineWidth }]} />);
      lines.push(<View key={`h${f}`} style={[styles.line, { top: rect.y + rect.h * f, left: rect.x, width: rect.w, height: StyleSheet.hairlineWidth }]} />);
    }
  } else if (grid === 'cross') {
    lines.push(<View key="cv" style={[styles.line, { left: rect.x + rect.w / 2 - 12, top: rect.y + rect.h / 2, width: 24, height: 1 }]} />);
    lines.push(<View key="ch" style={[styles.line, { left: rect.x + rect.w / 2, top: rect.y + rect.h / 2 - 12, width: 1, height: 24 }]} />);
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {guide !== 'off' && (
        <>
          <View style={[styles.mask, { left: 0, top: 0, right: 0, height: rect.y }]} />
          <View style={[styles.mask, { left: 0, bottom: 0, right: 0, height: height - rect.y - rect.h }]} />
          <View style={[styles.mask, { left: 0, top: rect.y, width: rect.x, height: rect.h }]} />
          <View style={[styles.mask, { right: 0, top: rect.y, width: width - rect.x - rect.w, height: rect.h }]} />
          <View style={[styles.guideBorder, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]} />
        </>
      )}
      {lines}
    </View>
  );
}

const styles = StyleSheet.create({
  histogram: {
    width: 128,
    height: 64,
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  bar: { flex: 1, backgroundColor: 'rgba(255,255,255,0.85)' },
  clipRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  clip: { width: 10, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)' },

  levelWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  levelSide: { width: 18, height: 2, backgroundColor: 'rgba(255,255,255,0.7)', marginHorizontal: 6 },
  levelLine: { width: 110, height: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  levelOn: { backgroundColor: '#FACC15' },
  levelText: { position: 'absolute', top: 8, color: '#fff', fontSize: 11, fontWeight: '600' },

  line: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.45)' },
  mask: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  guideBorder: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(250,204,21,0.8)' },
});
