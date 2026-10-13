// A face crop from People's on-phone database (never uploaded), as a circle.
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { LensPeople } from '../../modules/lens-camera';

const cache = new Map<number, string>();

export function FaceThumb({ faceId, size }: { faceId: number; size: number }) {
  const [uri, setUri] = useState(() => cache.get(faceId) ?? null);
  useEffect(() => {
    if (cache.has(faceId) || !LensPeople) return;
    let alive = true;
    LensPeople.faceThumb(faceId).then(
      (u) => {
        if (!u) return;
        cache.set(faceId, u);
        if (alive) setUri(u);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [faceId]);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: '#1C1C1E' }}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" /> : null}
    </View>
  );
}

/** After "Delete all face data": old crops must not show again. */
export function clearFaceThumbs() {
  cache.clear();
}
