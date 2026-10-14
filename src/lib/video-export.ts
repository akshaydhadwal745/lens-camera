import { LensImaging } from '../../modules/lens-camera';

/**
 * LensImaging.exportVideo, retried once after 1.5 s when the phone's video
 * encoders are busy ("Codec exception"). Right after a 4K recording CameraX keeps
 * the recording's encoder for about a second; on phones with room for only two
 * 4K codecs (Galaxy S9) an export started then can't get one (self-test dev-95).
 */
export async function exportVideoRetrying(uri: string, recipe: object | null): Promise<{ uri: string }> {
  if (!LensImaging) throw new Error('Video export is not available on this device.');
  try {
    return await LensImaging.exportVideo(uri, recipe);
  } catch (error) {
    if (!/codec/i.test(error instanceof Error ? error.message : String(error))) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return LensImaging.exportVideo(uri, recipe);
  }
}
