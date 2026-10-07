// Nothing is captured on web.
import { LocalEntry } from './types';

export function makeDerivatives(_entry: LocalEntry): Promise<Pick<LocalEntry, 'thumbFile' | 'previewFile'>> {
  return Promise.reject(new Error('Not available on web'));
}
