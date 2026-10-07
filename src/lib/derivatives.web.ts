// Nothing is captured on web.
import { LocalEntry } from './types';

export function makeDerivatives(_entry: LocalEntry): Promise<Pick<LocalEntry, 'thumbFile' | 'previewFile'>> {
  return Promise.reject(new Error('Not available on web'));
}

export const THUMB_PX = 400;
export const PREVIEW_PX = 2048;

export function posterUri(_entry: LocalEntry): Promise<string> {
  return Promise.reject(new Error('Not available on web'));
}
