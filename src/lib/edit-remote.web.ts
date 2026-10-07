// Editing happens on the phone only.
import type { File } from 'expo-file-system';

export async function renderCloudDerivatives(..._args: unknown[]): Promise<{ preview: File; thumb: File }> {
  throw new Error('Editing is not available on web');
}
export async function cachedOriginal(..._args: unknown[]): Promise<string> {
  throw new Error('Not available on web');
}
