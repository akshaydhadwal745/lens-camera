import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

/**
 * Keeps the screen on while `active` (e.g. while recording), like the stock
 * camera app. The phone's normal screen timeout returns as soon as it's false.
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
