// Native share / save-to-Photos. Cloud-only items are downloaded to the cache first.
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import { LensImaging } from '../../modules/lens-camera';
import { isNeutral } from './edits';
import { GalleryItem } from './types';

export const saveLabel = 'Save to Photos';

async function localFileUri(item: GalleryItem): Promise<string> {
  if (item.localUri) return item.localUri;
  if (!item.remoteUrl) throw new Error('The full-quality original is still uploading. Try again in a moment.');
  // Keep the original's real extension (heic, dng, mov…) so Photos imports it correctly.
  const ext = item.remoteUrl.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? (item.kind === 'video' ? 'mov' : 'jpg');
  const dest = new File(Paths.cache, `dl-${item.id}.${ext}`);
  if (dest.exists) return dest.uri;
  const file = await File.downloadFileAsync(item.remoteUrl, dest);
  return file.uri;
}

/**
 * File to share/save: the original, or — when the item has an edit — a
 * full-quality render of it (photos: HEIC; videos: HEVC re-encode). The
 * original in the cloud stays untouched either way.
 */
async function outputFileUri(item: GalleryItem): Promise<string> {
  const original = await localFileUri(item);
  if (isNeutral(item.edit) || !LensImaging) return original;
  if (item.kind === 'video') return (await LensImaging.exportVideo(original, item.edit!)).uri;
  return (await LensImaging.renderImage(original, item.edit!, { format: 'heic', quality: 0.95 })).uri;
}

const TYPES: Record<string, { mimeType: string; UTI: string }> = {
  jpg: { mimeType: 'image/jpeg', UTI: 'public.jpeg' },
  jpeg: { mimeType: 'image/jpeg', UTI: 'public.jpeg' },
  heic: { mimeType: 'image/heic', UTI: 'public.heic' },
  png: { mimeType: 'image/png', UTI: 'public.png' },
  dng: { mimeType: 'image/x-adobe-dng', UTI: 'com.adobe.raw-image' },
  mov: { mimeType: 'video/quicktime', UTI: 'com.apple.quicktime-movie' },
  mp4: { mimeType: 'video/mp4', UTI: 'public.mpeg-4' },
};

export async function shareMedia(item: GalleryItem): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const uri = await outputFileUri(item);
  const ext = uri.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '';
  await Sharing.shareAsync(uri, TYPES[ext] ?? (item.kind === 'video' ? TYPES.mov : TYPES.jpg));
}

export async function saveToDevice(item: GalleryItem): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) {
    throw new Error('Photos access was denied. Enable it in Settings to save.');
  }
  await MediaLibrary.Asset.create(await outputFileUri(item));
}
