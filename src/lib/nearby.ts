// Nearby Lens users on the same Wi-Fi (docs/design/organise-and-share.md, step 3).
// While a screen needs it (roll, share picker): if you're visible, get a fresh
// 15-minute code from the server and announce it; collect other phones' codes
// and ask the server who they are (it answers only for people who opted in).
// Stops when the screen closes: no background work, no battery cost.
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { nearbyDiscovery } from '../../modules/lens-device';
import { api, Person } from './api';

const CODE_REFRESH_MS = 10 * 60 * 1000;

export const nearbySupported = Platform.OS === 'android' && !!nearbyDiscovery;

// Screens below Settings stay mounted: tell them when "Visible to nearby" flips
// so they start (or stop) announcing now, not at the next 10-minute refresh.
const visibilityListeners = new Set<() => void>();
export function nearbyVisibilityChanged() {
  visibilityListeners.forEach((l) => l());
}

export function useNearbyPeople(active: boolean): Person[] {
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    if (!active || !nearbySupported) return;
    let alive = true;
    let stop: (() => void) | null = null;
    let codes: string[] = [];
    let resolveTimer: ReturnType<typeof setTimeout> | null = null;

    const resolve = () => {
      if (resolveTimer) clearTimeout(resolveTimer);
      // Codes arrive one by one: ask once they settle.
      resolveTimer = setTimeout(() => {
        if (!codes.length) {
          if (alive) setPeople([]);
          return;
        }
        api.nearbyResolve(codes).then(
          (r) => alive && setPeople(r.people),
          () => {},
        );
      }, 800);
    };

    const restart = async () => {
      stop?.();
      const code = await api.nearbyCode().then((r) => r.code, () => null);
      if (!alive) return;
      stop = nearbyDiscovery!.start(code, (found) => {
        codes = found;
        resolve();
      });
    };

    void restart();
    const refresh = setInterval(() => void restart(), CODE_REFRESH_MS);
    const onVisibility = () => void restart();
    visibilityListeners.add(onVisibility);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void restart();
      else {
        stop?.();
        stop = null;
      }
    });
    return () => {
      alive = false;
      clearInterval(refresh);
      visibilityListeners.delete(onVisibility);
      if (resolveTimer) clearTimeout(resolveTimer);
      sub.remove();
      stop?.();
    };
  }, [active]);

  return active ? people : [];
}
