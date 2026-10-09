import { Image, ImageSource } from 'expo-image';
import { useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const MAX = 5;
const DOUBLE_TAP = 2.5;

/**
 * A photo you can pinch, double-tap and pan, on Android, iPhone and the web
 * (ScrollView zoom only exists on iOS). Shows `placeholder` (the preview) until
 * `source` (full quality) has loaded.
 */
export function ZoomableImage({
  source,
  placeholder,
  width,
  height,
  onTap,
  onZoomChange,
}: {
  source: ImageSource | string | undefined;
  placeholder?: ImageSource | string;
  width: number;
  height: number;
  onTap: () => void;
  /** Called with true when zoomed in (the pager should stop swiping), false at 1×. */
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  const [tx] = useState(() => new Animated.Value(0));
  const [ty] = useState(() => new Animated.Value(0));
  // Current values, read in gesture callbacks (event time, not render).
  const s = useRef({ scale: 1, x: 0, y: 0, startScale: 1, startX: 0, startY: 0, zoomed: false });

  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    const v = s.current;
    const clamp = (x: number, y: number, k: number) => {
      const mx = ((k - 1) * width) / 2;
      const my = ((k - 1) * height) / 2;
      return [Math.max(-mx, Math.min(mx, x)), Math.max(-my, Math.min(my, y))] as const;
    };
    const apply = (k: number, x: number, y: number, animate = false) => {
      const [cx, cy] = clamp(x, y, k);
      v.scale = k;
      v.x = cx;
      v.y = cy;
      if (animate) {
        Animated.parallel([
          Animated.timing(scale, { toValue: k, duration: 200, useNativeDriver: true }),
          Animated.timing(tx, { toValue: cx, duration: 200, useNativeDriver: true }),
          Animated.timing(ty, { toValue: cy, duration: 200, useNativeDriver: true }),
        ]).start();
      } else {
        scale.setValue(k);
        tx.setValue(cx);
        ty.setValue(cy);
      }
      const zoomed = k > 1.01;
      if (zoomed !== v.zoomed) {
        v.zoomed = zoomed;
        onZoomChange?.(zoomed);
      }
    };

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        v.startScale = v.scale;
        v.startX = v.x;
        v.startY = v.y;
      })
      .onUpdate((e) => {
        const k = Math.max(1, Math.min(MAX, v.startScale * e.scale));
        // Keep the point between the fingers where it is.
        const fx = e.focalX - width / 2;
        const fy = e.focalY - height / 2;
        const ratio = k / v.startScale;
        apply(k, fx - (fx - v.startX) * ratio, fy - (fy - v.startY) * ratio);
      })
      .onEnd(() => {
        if (v.scale < 1.05) apply(1, 0, 0, true);
      });

    const pan = Gesture.Pan()
      .runOnJS(true)
      .averageTouches(true)
      .onStart(() => {
        v.startX = v.x;
        v.startY = v.y;
      })
      .onUpdate((e) => {
        if (v.scale > 1.01) apply(v.scale, v.startX + e.translationX, v.startY + e.translationY);
      });
    // Only pan while zoomed in; at 1× the swipe goes to the pager.
    pan.manualActivation(true).onTouchesMove((_, state) => (v.scale > 1.01 ? state.activate() : state.fail()));

    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd((e) => {
        if (v.scale > 1.01) {
          apply(1, 0, 0, true);
        } else {
          const fx = e.x - width / 2;
          const fy = e.y - height / 2;
          apply(DOUBLE_TAP, -fx * (DOUBLE_TAP - 1), -fy * (DOUBLE_TAP - 1), true);
        }
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => onTap())
      .requireExternalGestureToFail(doubleTap);

    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, tap));
  }, [width, height, onTap, onZoomChange, scale, tx, ty]);
  /* eslint-enable react-hooks/refs */

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.frame, { width, height }]} collapsable={false}>
        <Animated.View style={{ width, height, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}>
          <Image
            source={source}
            placeholder={placeholder}
            placeholderContentFit="contain"
            style={{ width, height }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={200}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
});
