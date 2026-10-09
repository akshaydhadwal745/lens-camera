import { useEffect, useState } from 'react';

import { api } from './api';
import type { GalleryItem } from './types';

/** Long or big videos get adaptive streaming (540p up to the original's resolution) when played from the cloud. */
const LONG_SECONDS = 60;
const BIG_BYTES = 100 * 1024 * 1024;

/** `asking`: waiting for Lens's answer (don't start loading the big original yet). */
export type StreamState = { url: string | null; preparing: boolean; asking: boolean };

/**
 * For a video that isn't on this phone: asks Lens for a smooth-streaming link.
 * The first viewer of a long video triggers a one-time conversion (about a
 * minute); meanwhile (and for short clips) the original plays as before.
 */
export function useStream(item: GalleryItem | undefined, enabled: boolean): StreamState {
  const eligible =
    enabled &&
    !!item &&
    item.kind === 'video' &&
    !item.localUri &&
    !item.location &&
    ((item.duration ?? 0) >= LONG_SECONDS || (item.size ?? 0) >= BIG_BYTES);
  const [state, setState] = useState<{ id: string; url: string | null; preparing: boolean } | null>(null);

  useEffect(() => {
    if (!eligible || !item) return;
    let live = true;
    api
      .stream(item.id, item.ownerId)
      .then((r) => live && setState({ id: item.id, url: r.status === 'ready' ? (r.url ?? null) : null, preparing: r.status === 'preparing' }))
      .catch(() => live && setState({ id: item.id, url: null, preparing: false }));
    return () => {
      live = false;
    };
  }, [eligible, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!eligible || !item) return { url: null, preparing: false, asking: false };
  if (state?.id !== item.id) return { url: null, preparing: false, asking: true };
  return { url: state.url, preparing: state.preparing, asking: false };
}
