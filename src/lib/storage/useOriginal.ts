import { useEffect, useState } from 'react';

import type { GalleryItem } from '../types';
import { originalSource } from './index';
import type { MediaSource } from './types';

/**
 * Where to load an item's full-quality original from: this phone, Lens, or
 * the user's own storage (with auth headers). null while unknown/unreachable.
 */
export function useOriginal(item: GalleryItem | undefined, enabled = true): MediaSource | null {
  const direct = item?.localUri ?? item?.remoteUrl;
  const ref = item?.location?.ref;
  // Remember which file the resolved source belongs to, so a stale one is never shown.
  const [resolved, setResolved] = useState<{ ref: string; source: MediaSource | null } | null>(null);

  useEffect(() => {
    if (!enabled || direct || !ref || !item?.location) return;
    let live = true;
    void originalSource(item.location).then((source) => live && setResolved({ ref, source }));
    return () => {
      live = false;
    };
  }, [enabled, direct, ref]); // eslint-disable-line react-hooks/exhaustive-deps

  if (direct) return { uri: direct };
  return enabled && resolved && resolved.ref === ref ? resolved.source : null;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/heic': 'heic',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/x-adobe-dng': 'dng',
  'video/quicktime': 'mov',
  'video/mp4': 'mp4',
};

export function extensionFor(contentType: string | undefined, kind: 'photo' | 'video'): string {
  return (contentType && EXT[contentType]) ?? (kind === 'video' ? 'mov' : 'jpg');
}
