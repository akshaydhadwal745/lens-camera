// Website: upload photos and videos from a computer. Same rules as the phones:
// the original goes up byte for byte (every part MD5-checked by S3, resumable),
// and a small thumbnail + preview go first so the item appears everywhere fast.
import { api } from './api';
import { md5Base64 } from './md5';
import { newId } from './types';

export const PREVIEW_PX = 2048;
export const THUMB_PX = 400;
const SINGLE_MAX = 16 * 1024 * 1024;

const TYPES: Record<string, { type: string; kind: 'photo' | 'video' }> = {
  jpg: { type: 'image/jpeg', kind: 'photo' },
  jpeg: { type: 'image/jpeg', kind: 'photo' },
  png: { type: 'image/png', kind: 'photo' },
  heic: { type: 'image/heic', kind: 'photo' },
  heif: { type: 'image/heif', kind: 'photo' },
  webp: { type: 'image/webp', kind: 'photo' },
  avif: { type: 'image/avif', kind: 'photo' },
  dng: { type: 'image/x-adobe-dng', kind: 'photo' },
  mp4: { type: 'video/mp4', kind: 'video' },
  m4v: { type: 'video/mp4', kind: 'video' },
  mov: { type: 'video/quicktime', kind: 'video' },
};

/** What Lens accepts, for the file picker. */
export const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',') + ',image/*,video/mp4,video/quicktime';

export function typeOf(file: File): { type: string; kind: 'photo' | 'video' } | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPES[ext] ?? Object.values(TYPES).find((t) => t.type === file.type) ?? null;
}

// ---------- Previews (made in the browser) ----------

type Derivative = { blob: Blob; md5: string };
type Previews = { thumb: Derivative; preview: Derivative; width: number; height: number; duration?: number };

async function toJpeg(source: CanvasImageSource, w: number, h: number, longest: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, longest / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Preview failed'))), 'image/jpeg', quality));
}

async function videoFrame(file: File): Promise<{ frame: HTMLVideoElement; duration: number; url: string }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Video can’t be read'));
  });
  video.currentTime = Math.min(1, video.duration / 2 || 0);
  await new Promise<void>((resolve) => (video.onseeked = () => resolve()));
  return { frame: video, duration: video.duration, url };
}

/** Thumbnail + preview, or null if this browser can't decode the file (e.g. HEIC/RAW). */
async function makePreviews(file: File, kind: 'photo' | 'video'): Promise<Previews | null> {
  try {
    let source: CanvasImageSource;
    let w: number;
    let h: number;
    let duration: number | undefined;
    let cleanup = () => {};
    if (kind === 'photo') {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      source = bitmap;
      w = bitmap.width;
      h = bitmap.height;
      cleanup = () => bitmap.close();
    } else {
      const v = await videoFrame(file);
      source = v.frame;
      w = v.frame.videoWidth;
      h = v.frame.videoHeight;
      duration = v.duration;
      cleanup = () => URL.revokeObjectURL(v.url);
    }
    try {
      const preview = await toJpeg(source, w, h, PREVIEW_PX, 0.82);
      const thumb = await toJpeg(source, w, h, THUMB_PX, 0.8);
      return {
        preview: { blob: preview, md5: await md5Base64(preview) },
        thumb: { blob: thumb, md5: await md5Base64(thumb) },
        width: w,
        height: h,
        duration,
      };
    } finally {
      cleanup();
    }
  } catch {
    return null;
  }
}

/** JPEG EXIF DateTimeOriginal, so old photos sort by when they were taken. */
async function takenAt(file: File): Promise<number | undefined> {
  try {
    const head = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
    if (head.getUint16(0) !== 0xffd8) return undefined;
    let p = 2;
    while (p + 4 < head.byteLength) {
      const marker = head.getUint16(p);
      const len = head.getUint16(p + 2);
      if (marker === 0xffe1 && head.getUint32(p + 4) === 0x45786966) {
        const tiff = p + 10;
        const little = head.getUint16(tiff) === 0x4949;
        const u16 = (o: number) => head.getUint16(o, little);
        const u32 = (o: number) => head.getUint32(o, little);
        const readTag = (ifd: number, tag: number) => {
          const n = u16(ifd);
          for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            if (u16(e) === tag) return e;
          }
          return -1;
        };
        const exifPtr = readTag(tiff + u32(tiff + 4), 0x8769);
        if (exifPtr < 0) return undefined;
        const date = readTag(tiff + u32(exifPtr + 8), 0x9003);
        if (date < 0) return undefined;
        const at = tiff + u32(date + 8);
        const text = Array.from({ length: 19 }, (_, i) => String.fromCharCode(head.getUint8(at + i))).join('');
        const m = text.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : undefined;
      }
      p += 2 + len;
    }
  } catch {
    // No date: use the file's own time.
  }
  return undefined;
}

// ---------- Upload ----------

function put(url: string, body: Blob, headers: Record<string, string>, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error while uploading'));
    xhr.send(body);
  });
}

export type UploadJob = { id: string; name: string; size: number; progress: number; state: 'waiting' | 'uploading' | 'done' | 'failed'; error?: string };

/** Uploads one file. `onProgress` gets 0…1. */
export async function uploadFile(file: File, onProgress: (fraction: number) => void): Promise<void> {
  const t = typeOf(file);
  if (!t) throw new Error('This file type isn’t supported');
  const id = newId();
  const previews = await makePreviews(file, t.kind);
  const whole = file.size <= SINGLE_MAX ? await md5Base64(file) : undefined;
  const plan = await api.startUpload({
    id,
    kind: t.kind,
    contentType: t.type,
    size: file.size,
    md5: whole,
    width: previews?.width,
    height: previews?.height,
    duration: previews?.duration,
    createdAt: (await takenAt(file)) ?? file.lastModified ?? Date.now(),
    derivatives: previews
      ? { thumb: { md5: previews.thumb.md5, size: previews.thumb.blob.size }, preview: { md5: previews.preview.md5, size: previews.preview.blob.size } }
      : undefined,
  });

  if (plan.derivativeUrls && previews) {
    for (const name of ['thumb', 'preview'] as const) {
      const url = plan.derivativeUrls[name];
      if (url) await put(url, previews[name].blob, { 'Content-Type': 'image/jpeg', 'Content-MD5': previews[name].md5 }, () => {});
    }
    await api.previewsUploaded(id);
  }
  if (plan.mode === 'done') return onProgress(1);
  if (plan.mode === 'external') throw new Error('Uploads to your own storage work from the phone app for now');

  if (plan.mode === 'single') {
    await put(plan.url, file, { 'Content-Type': plan.contentType, ...(whole ? { 'Content-MD5': whole } : {}) }, (sent) => onProgress(sent / file.size));
  } else {
    const { partSize } = plan;
    const total = Math.ceil(file.size / partSize);
    const sent = new Map<number, number>();
    const report = () => onProgress(Math.min(0.99, [...sent.values()].reduce((a, b) => a + b, 0) / file.size));
    let next = 1;
    const worker = async () => {
      while (next <= total) {
        const n = next++;
        const part = file.slice((n - 1) * partSize, Math.min(file.size, n * partSize));
        const md5 = await md5Base64(part);
        const { urls } = await api.partUrls(id, [{ n, md5 }]);
        await put(urls[n], part, { 'Content-MD5': md5 }, (bytes) => {
          sent.set(n, bytes);
          report();
        });
        sent.set(n, part.size);
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
  }
  await api.complete(id);
  onProgress(1);
}
