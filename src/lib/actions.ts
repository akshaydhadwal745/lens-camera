// Native share / save-to-Photos. Cloud-only items are downloaded to the cache first.
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

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

export async function shareMedia(item: GalleryItem): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(await localFileUri(item), {
    mimeType: item.kind === 'video' ? 'video/quicktime' : 'image/jpeg',
    UTI: item.kind === 'video' ? 'com.apple.quicktime-movie' : 'public.jpeg',
  });
}

export async function saveToDevice(item: GalleryItem): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) {
    throw new Error('Photos access was denied. Enable it in Settings to save.');
  }
  await MediaLibrary.Asset.create(await localFileUri(item));
}
