import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Camera left untouched this long lets the phone's own screen timeout work again. */
const CAMERA_IDLE_MS = 2 * 60 * 1000;

/**
 * Keeps the screen on while `active`. The phone's normal screen timeout returns
 * as soon as it's false.
 */
export function useKeepAwakeWhile(active: boolean, tag: string) {
  useEffect(() => {
    if (!active) return;
    activateKeepAwakeAsync(tag).catch(() => {});
    return () => {
      deactivateKeepAwake(tag).catch(() => {});
    };
  }, [active, tag]);
}

/**
 * Screen rules for the camera, like the stock camera app: on while the camera
 * is on screen and being used, released after 2 minutes without a touch (saves
 * battery and heat), always on while recording. Only the camera does this; the
 * rest of the app follows the phone's screen timeout.
 *
 * Returns a function to call on every touch (the camera root's onTouchStart).
 */
export function useCameraKeepAwake(focused: boolean, recording: boolean) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restartIdleTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), CAMERA_IDLE_MS);
  }, []);

  useEffect(() => {
    if (!focused) return;
    restartIdleTimer();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      setIdle(false);
    };
  }, [focused, restartIdleTimer]);

  useKeepAwakeWhile(focused && (recording || !idle), 'camera');

  return useCallback(() => {
    setIdle(false);
    restartIdleTimer();
  }, [restartIdleTimer]);
}
