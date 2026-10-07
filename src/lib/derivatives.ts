// Thumbnail + preview made on the phone right after capture. Cheap (one
// decode, two resizes, ~100 ms) and never touches the original. For videos
// only a single poster frame is decoded — no transcoding on the phone.
import { File } from 'expo-file-system';
import { ImageManipulator, ImageRef, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';

import { captureFile, uriFor } from './local-store';
import { LocalEntry } from './types';

export const THUMB_PX = 400;
export const PREVIEW_PX = 2048;
const QUALITY = 0.8;

/** A file URI or a decoded native image (ImageRef, video frame). */
type Source = Parameters<typeof ImageManipulator.manipulate>[0];

async function render(source: Source, longest: number | null): Promise<ImageRef> {
  const context = ImageManipulator.manipulate(source);
  if (longest) {
    const base = await context.renderAsync();
    if (Math.max(base.width, base.height) <= longest) return base; // never upscale
    const size = base.width >= base.height ? { width: longest } : { height: longest };
    return ImageManipulator.manipulate(base).resize(size).renderAsync();
  }
  return context.renderAsync();
}

async function save(image: ImageRef, name: string): Promise<string> {
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY });
  const target = captureFile(name);
  if (target.exists) target.delete();
  new File(result.uri).move(target);
  return name;
}

async function posterFrame(entry: LocalEntry): Promise<Source> {
  const player = createVideoPlayer(uriFor(entry));
  try {
    const [frame] = await player.generateThumbnailsAsync(Math.min(1, (entry.duration ?? 2) / 2), {
      maxWidth: PREVIEW_PX,
      maxHeight: PREVIEW_PX,
    });
    if (!frame) throw new Error('No video frame');
    // VideoThumbnail is a native image ref the manipulator accepts directly.
    return frame as unknown as Source;
  } finally {
    player.release();
  }
}

const inflight = new Map<string, Promise<Pick<LocalEntry, 'thumbFile' | 'previewFile'>>>();

/** Creates (once) the thumbnail + preview files for an entry. */
export function makeDerivatives(entry: LocalEntry): Promise<Pick<LocalEntry, 'thumbFile' | 'previewFile'>> {
  const existing = inflight.get(entry.id);
  if (existing) return existing;
  const job = (async () => {
    const source: Source = entry.kind === 'video' ? await posterFrame(entry) : uriFor(entry);
    const preview = await render(source, PREVIEW_PX);
    const thumb = await render(preview as unknown as Source, THUMB_PX);
    return {
      previewFile: await save(preview, `${entry.id}.preview.jpg`),
      thumbFile: await save(thumb, `${entry.id}.thumb.jpg`),
    };
  })().finally(() => inflight.delete(entry.id));
  inflight.set(entry.id, job);
  return job;
}
