import { useEffect, useState } from 'react';

import type { GalleryItem } from './types';
import { askStream, cachedStream, streamEligible } from './video-prefetch';

/** `asking`: waiting for Lens's answer (don't start loading the big original yet). */
export type StreamState = { url: string | null; preparing: boolean; asking: boolean };

/**
 * For a video that isn't on this phone: asks Lens for a smooth-streaming link
 * (long ≥ 60 s or big ≥ 100 MB cloud videos). The first viewer of a long video
 * triggers a one-time conversion (about a minute); meanwhile (and for short
 * clips) the original plays as before. Answers are shared with intent
 * preloading, so a preloaded video doesn't ask again.
 */
export function useStream(item: GalleryItem | undefined, enabled: boolean): StreamState {
  const eligible = enabled && !!item && streamEligible(item);
  const [state, setState] = useState<{ id: string; url: string | null; preparing: boolean } | null>(null);

  useEffect(() => {
    if (!eligible || !item) return;
    let live = true;
    void askStream(item).then((a) => live && setState({ id: item.id, url: a.url, preparing: a.preparing }));
    return () => {
      live = false;
    };
  }, [eligible, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!eligible || !item) return { url: null, preparing: false, asking: false };
  const known = state?.id === item.id ? state : cachedStream(item.id);
  if (!known) return { url: null, preparing: false, asking: true };
  return { url: known.url, preparing: known.preparing, asking: false };
}
