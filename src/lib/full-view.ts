// What the full-screen viewer shows once full quality is allowed: the
// original itself, or, for an edited photo, the original rendered with its
// edit at high resolution (never the lower-quality preview, never the
// unedited original). The preview is shown until this is ready.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { isImagingAvailable, LensImaging } from '../../modules/lens-camera';
import { cachedOriginal } from './edit-remote';
import { EditRecipe, isNeutral } from './edits';
import { asFileUri } from './content-file';
import { extensionFor, useOriginal } from './storage/useOriginal';
import type { MediaSource } from './storage/types';
import type { GalleryItem } from './types';

/** Longest side of the edited full view: sharp on any phone/tablet screen, even zoomed 2×. */
const FULL_VIEW_PX = 4096;

/** Formats every browser can draw (HEIC/DNG can't be shown on the web). */
const WEB_DECODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

const rendered = new Map<string, string>();

export function hasEdit(item: GalleryItem | undefined): boolean {
  return !!item && !isNeutral(item.edit);
}

/** The web can show this photo's original as-is (unedited, browser-decodable). */
export function webCanShowOriginal(item: GalleryItem): boolean {
  return !hasEdit(item) && !!item.contentType && WEB_DECODABLE.has(item.contentType);
}

export function useFullQuality(item: GalleryItem | undefined, allowed: boolean): MediaSource | null {
  const edited = hasEdit(item);
  const web = Platform.OS === 'web';
  // Unedited: the original file (this phone, Lens, or the user's own storage).
  const original = useOriginal(item, allowed && !edited && (!web || (!!item && webCanShowOriginal(item))));
  const key = item && edited ? `${item.id}:${JSON.stringify(item.edit)}` : null;
  const [render, setRender] = useState<{ key: string; uri: string } | null>(null);

  useEffect(() => {
    if (!item || !key || !allowed || !isImagingAvailable || item.kind !== 'photo' || rendered.has(key)) return;
    let live = true;
    (async () => {
      const source = item.localUri
        ? await asFileUri(item.localUri, item.id, extensionFor(item.contentType, item.kind))
        :
        (await cachedOriginal({ id: item.id, url: item.remoteUrl, kind: item.kind, location: item.location, contentType: item.contentType }));
      const out = await LensImaging!.renderImage(source, item.edit as EditRecipe, { maxPixel: FULL_VIEW_PX, format: 'jpeg', quality: 0.95 });
      rendered.set(key, out.uri);
      if (live) setRender({ key, uri: out.uri });
    })().catch(() => {
      // Keep showing the edited preview.
    });
    return () => {
      live = false;
    };
  }, [key, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (item?.kind !== 'photo') return null;
  if (edited) {
    const done = key ? (rendered.get(key) ?? (render?.key === key ? render.uri : undefined)) : undefined;
    return allowed && done ? { uri: done } : null;
  }
  return original;
}

/**
 * Motion photo (checklist 9.2): the clip inside a JPEG this phone took with
 * Motion on, extracted once into the cache; null for every other photo.
 */
export function useMotionVideo(item: GalleryItem | undefined): string | null {
  const [found, setFound] = useState<{ id: string; uri: string | null } | null>(null);
  const id = item?.id;
  const localUri = item?.kind === 'photo' && (!item.contentType || item.contentType === 'image/jpeg') ? item.localUri : undefined;
  useEffect(() => {
    if (!id || !localUri || Platform.OS !== 'android' || !LensImaging?.motionVideo) return;
    let live = true;
    asFileUri(localUri, id, 'jpg')
      .then((file) => LensImaging!.motionVideo!(file))
      .then((uri) => {
        if (live) setFound({ id, uri });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, localUri]);
  return found && found.id === id ? found.uri : null;
}
