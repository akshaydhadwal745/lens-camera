// Web share / open original.
import { GalleryItem } from './types';

export const saveLabel = 'Open original';

export async function shareMedia(item: GalleryItem): Promise<void> {
  const url = item.remoteUrl;
  if (!url) throw new Error('This item is not available.');
  if (navigator.share) {
    await navigator.share({ url });
    return;
  }
  await navigator.clipboard.writeText(url);
  window.alert('Link copied. It stays valid for a few hours.');
}

export async function saveToDevice(item: GalleryItem): Promise<void> {
  if (!item.remoteUrl) throw new Error('This item is not available.');
  window.open(item.remoteUrl, '_blank', 'noopener');
}
