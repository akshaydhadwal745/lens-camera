// Imported items point at the user's own gallery file (content://). Share,
// Save and edit renders need a real file: copy it into the cache (named "dl-"
// so the storage guardian can clear it like other downloads).
import { File, Paths } from 'expo-file-system';

import { mediaPicker } from '../../modules/lens-device';

export async function asFileUri(uri: string, id: string, ext: string): Promise<string> {
  if (!uri.startsWith('content:')) return uri;
  if (!mediaPicker) throw new Error('This item can’t be read on this phone');
  const dest = new File(Paths.cache, `dl-${id}.${ext}`);
  if (dest.exists) return dest.uri;
  await mediaPicker.copy(uri, dest.uri);
  return dest.uri;
}
