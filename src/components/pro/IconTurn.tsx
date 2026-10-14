// Lens is portrait-only (stock-camera style): the layout never flips; when the
// phone is turned, the camera's icons and labels turn to stay upright. The
// native camera view reports how the phone is held (onDeviceOrientation, from
// the motion sensor that also keeps photos upright).
import { createContext, ReactNode, useContext, useState } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';

type Turn = Animated.AnimatedInterpolation<string>;
const TurnContext = createContext<Turn | null>(null);

/** One rotation for all the camera's icons (+ the handler for the camera's orientation event). */
class IconTurn {
  private value = new Animated.Value(0);
  private target = 0;
  readonly turn: Turn = this.value.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'], extrapolate: 'extend' });

  /** `degrees`: how far the phone is turned clockwise (0/90/180/270). Takes the shortest way round. */
  onDeviceOrientation = (degrees: number) => {
    const desired = (360 - degrees) % 360;
    const delta = ((((desired - this.target) % 360) + 540) % 360) - 180;
    if (delta === 0) return;
    this.target += delta;
    Animated.timing(this.value, { toValue: this.target, duration: 260, useNativeDriver: true }).start();
  };
}

export function useIconTurn(): IconTurn {
  const [iconTurn] = useState(() => new IconTurn());
  return iconTurn;
}

export function IconTurnProvider({ turn, children }: { turn: Turn; children: ReactNode }) {
  return <TurnContext.Provider value={turn}>{children}</TurnContext.Provider>;
}

/** Keeps its contents upright however the phone is held. */
export function Upright({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const turn = useContext(TurnContext);
  return <Animated.View style={[style, turn ? { transform: [{ rotate: turn }] } : null]}>{children}</Animated.View>;
}
