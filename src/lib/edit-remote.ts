// Editing an item that only exists in the cloud: download the original once
// (cache), render the new thumbnail + preview from it on the device.
import { File, Paths } from 'expo-file-system';

import { LensImaging } from '../../modules/lens-camera';
import { PREVIEW_PX, THUMB_PX } from './derivatives';
import { EditRecipe } from './edits';
import { downloadFromStorage } from './storage';
import { extensionFor } from './storage/useOriginal';
import { RemoteMedia } from './types';

export async function cachedOriginal(
  remote: Pick<RemoteMedia, 'id' | 'url' | 'kind' | 'location' | 'contentType'>,
): Promise<string> {
  if (!remote.url && remote.location?.ref) {
    // Original in the user's own storage.
    return downloadFromStorage(remote.id, remote.location, extensionFor(remote.contentType, remote.kind));
  }
  if (!remote.url) throw new Error('The original is still uploading.');
  const ext = remote.url.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? (remote.kind === 'video' ? 'mov' : 'jpg');
  const dest = new File(Paths.cache, `orig-${remote.id}.${ext}`);
  if (dest.exists) return dest.uri;
  return (await File.downloadFileAsync(remote.url, dest)).uri;
}

export async function renderCloudDerivatives(remote: RemoteMedia, edit: EditRecipe | null) {
  if (!LensImaging) throw new Error('Editing needs the Lens app build (not Expo Go).');
  let source: string;
  let recipe: EditRecipe | null = edit;
  if (remote.kind === 'video') {
    // Videos: apply the look to the poster frame (a clean preview is needed).
    if (!remote.previewUrl) throw new Error('Video preview not available yet.');
    const posterDest = new File(Paths.cache, `poster-${remote.id}.jpg`);
    source = posterDest.exists ? posterDest.uri : (await File.downloadFileAsync(remote.previewUrl, posterDest)).uri;
    if (edit) {
      const { crop: _c, portrait: _p, ...look } = edit;
      recipe = look;
    }
  } else {
    source = await cachedOriginal(remote);
  }
  const preview = await LensImaging.renderImage(source, recipe, { maxPixel: PREVIEW_PX, format: 'jpeg', quality: 0.85 });
  const thumb = await LensImaging.renderImage(preview.uri, null, { maxPixel: THUMB_PX, format: 'jpeg', quality: 0.8 });
  return { preview: new File(preview.uri), thumb: new File(thumb.uri) };
}
