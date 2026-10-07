// The web app is a viewer only; nothing is uploaded from the browser.
import { LocalEntry, RemoteMedia } from './types';

export class UploadCancelled extends Error {}

export async function uploadEntry(_entry: LocalEntry, _options: unknown): Promise<RemoteMedia> {
  throw new Error('Uploading is not available on web');
}
