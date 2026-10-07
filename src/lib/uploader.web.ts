// The web app is a viewer only; nothing is uploaded from the browser.
import { LocalEntry, RemoteMedia } from './types';

export class UploadCancelled extends Error {}

export type UploadResult = { media: RemoteMedia; originalDone: boolean };

export async function uploadEntry(_entry: LocalEntry, _options: unknown): Promise<UploadResult> {
  throw new Error('Uploading is not available on web');
}

export async function pushEdit(): Promise<RemoteMedia> {
  throw new Error('Editing is not available on web');
}
