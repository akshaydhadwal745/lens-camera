// /e/<code>/: an event album link (docs/design/switch-features.md §3).
// Anyone can see the album's previews; "Add your photos" (and videos) works without the app:
// the browser gets a guest session (HttpOnly cookie, like a new phone gets a
// guest name), joins, and uploads each photo the way the app does: thumbnail +
// preview made here, every byte MD5-checked by the cloud on arrival.
import SparkMD5 from 'spark-md5';

type EventInfo = {
  event: { name: string; ownerName: string; count: number; people: number; joined: boolean; isOwner: boolean };
  items: { id: string; kind: string; thumbUrl?: string }[];
};
type Plan = { mode: 'single' | 'multipart' | 'done' | 'external'; url?: string; contentType?: string; partSize?: number; derivativeUrls?: { thumb?: string; preview?: string } };

const API = '/api/v1';
const MAX_FILES = 50;
const MAX_BYTES = 16 * 1024 * 1024;
/** Videos from the browser (guests have 5 GB in all): big ones go up in parts, 3 at a time. */
const MAX_VIDEO_BYTES = 2 * 1024 ** 3;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];

const code = location.pathname.split('/')[2] ?? '';
const valid = /^[A-Za-z0-9_-]{10,16}$/.test(code);
const $ = (id: string) => document.getElementById(id)!;
const status = $('event-status');

class ApiError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-lens-web': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Something went wrong (${res.status})`);
  return data as T;
}

function say(text: string, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
  status.hidden = !text;
}

// ---------- The album ----------

const openApp = $('open-app') as HTMLAnchorElement;
if (valid) {
  openApp.href = /Android/i.test(navigator.userAgent)
    ? `intent://e/${code}#Intent;scheme=lens;package=com.instagrowapp.lens;S.browser_fallback_url=${encodeURIComponent(location.origin + '/download/')};end`
    : `lens://e/${code}`;
}

function broken() {
  $('event-name').textContent = 'This link doesn’t work';
  $('event-meta').textContent = 'It may have been turned off. Ask whoever shared it for a new one.';
  $('event-actions').hidden = true;
  $('event-note').hidden = true;
}

async function load() {
  const info = await call<EventInfo>('GET', `/events/${code}`);
  const e = info.event;
  document.title = `${e.name} · Lens`;
  $('event-name').textContent = e.name;
  $('event-meta').textContent = `By ${e.ownerName} · ${e.count} ${e.count === 1 ? 'item' : 'items'} · ${e.people} ${e.people === 1 ? 'person' : 'people'}`;
  const grid = $('event-grid');
  grid.replaceChildren();
  for (const item of info.items) {
    if (!item.thumbUrl) continue;
    const img = document.createElement('img');
    img.src = item.thumbUrl;
    img.alt = item.kind === 'video' ? 'Video' : 'Photo';
    img.loading = 'lazy';
    img.decoding = 'async';
    grid.appendChild(img);
  }
  $('event-empty').hidden = info.items.length > 0;
}

if (!valid) broken();
else load().catch(broken);

// ---------- Adding photos from the browser ----------

/** A signed-in or guest session in the cookie; makes a guest one if there's none. Returns the name. */
async function ensureSession(): Promise<string> {
  try {
    return (await call<{ name: string }>('GET', '/me')).name;
  } catch {
    return (await call<{ name: string }>('POST', '/web/guest')).name;
  }
}

/** Time-sortable media id, the format the API expects. */
function newId(): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('');
  return `${Date.now().toString(36).padStart(8, '0')}-${rand}`;
}

function md5Base64(buffer: ArrayBuffer): string {
  const hex = SparkMD5.ArrayBuffer.hash(buffer);
  let bin = '';
  for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin);
}

/** JPEG copy whose longest side is at most `max` px (the photo's own orientation applied). */
async function scaled(bitmap: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make a preview'))), 'image/jpeg', quality));
}

async function put(url: string, body: Blob | ArrayBuffer, type: string, md5: string) {
  const res = await fetch(url, { method: 'PUT', body, headers: { 'content-type': type, 'content-md5': md5 } });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

/** One photo, like the app: previews first (it shows up everywhere quickly), then the original. */
async function uploadPhoto(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const md5 = md5Base64(bytes);
  let thumb: Blob | null = null;
  let preview: Blob | null = null;
  let size: { width: number; height: number } | null = null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    size = { width: bitmap.width, height: bitmap.height };
    thumb = await scaled(bitmap, 400, 0.8);
    preview = await scaled(bitmap, 2048, 0.85);
    bitmap.close();
  } catch {
    // This browser can't decode it (e.g. HEIC outside Safari): the original still goes up.
  }
  const thumbBytes = thumb ? await thumb.arrayBuffer() : null;
  const previewBytes = preview ? await preview.arrayBuffer() : null;
  const derivatives =
    thumbBytes && previewBytes
      ? { thumb: { md5: md5Base64(thumbBytes), size: thumbBytes.byteLength }, preview: { md5: md5Base64(previewBytes), size: previewBytes.byteLength } }
      : undefined;
  const id = newId();
  const plan = await call<Plan>('POST', '/media', {
    id,
    kind: 'photo',
    contentType: file.type,
    size: file.size,
    md5,
    ...(size ?? {}),
    createdAt: file.lastModified || Date.now(),
    derivatives,
  });
  if (derivatives && plan.derivativeUrls?.thumb && plan.derivativeUrls.preview) {
    await put(plan.derivativeUrls.thumb, thumbBytes!, 'image/jpeg', derivatives.thumb.md5);
    await put(plan.derivativeUrls.preview, previewBytes!, 'image/jpeg', derivatives.preview.md5);
    await call('POST', `/media/${id}/previews`);
  }
  if (plan.mode === 'single' && plan.url) {
    await put(plan.url, bytes, plan.contentType ?? file.type, md5);
    await call('POST', `/media/${id}/complete`);
  } else if (plan.mode !== 'done') {
    throw new Error('This photo is too big to add from a browser. Use the Lens app.');
  }
  return id;
}

/** MD5 of a big file without holding it all in memory (8 MiB slices). */
async function md5OfBlob(blob: Blob): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  for (let at = 0; at < blob.size; at += 8 * 1024 * 1024) spark.append(await blob.slice(at, at + 8 * 1024 * 1024).arrayBuffer());
  const hex = spark.end();
  let bin = '';
  for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin);
}

/** A frame from the middle of the first second(s) for the thumbnail and preview, plus size and length. */
async function videoFrame(file: File): Promise<{ thumb: Blob; preview: Blob; width: number; height: number; duration: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('unreadable'));
    });
    video.currentTime = Math.min(1, video.duration / 2 || 0);
    await new Promise<void>((resolve) => (video.onseeked = () => resolve()));
    const frame = async (max: number, quality: number) => {
      const ratio = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * ratio));
      canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('preview'))), 'image/jpeg', quality));
    };
    return { thumb: await frame(400, 0.8), preview: await frame(2048, 0.85), width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  } catch {
    return null; // this browser can't decode it: the video still goes up, the cloud makes the stream
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One video: previews first, then the original (one PUT, or parts for big files). */
async function uploadVideo(file: File, progress: (fraction: number) => void): Promise<string> {
  const contentType = file.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const shot = await videoFrame(file);
  const thumbBytes = shot ? await shot.thumb.arrayBuffer() : null;
  const previewBytes = shot ? await shot.preview.arrayBuffer() : null;
  const derivatives =
    thumbBytes && previewBytes
      ? { thumb: { md5: md5Base64(thumbBytes), size: thumbBytes.byteLength }, preview: { md5: md5Base64(previewBytes), size: previewBytes.byteLength } }
      : undefined;
  const small = file.size <= 64 * 1024 * 1024;
  const md5 = small ? await md5OfBlob(file) : undefined;
  const id = newId();
  const plan = await call<Plan>('POST', '/media', {
    id,
    kind: 'video',
    contentType,
    size: file.size,
    md5,
    ...(shot ? { width: shot.width, height: shot.height, duration: shot.duration } : {}),
    createdAt: file.lastModified || Date.now(),
    derivatives,
  });
  if (derivatives && plan.derivativeUrls?.thumb && plan.derivativeUrls.preview) {
    await put(plan.derivativeUrls.thumb, thumbBytes!, 'image/jpeg', derivatives.thumb.md5);
    await put(plan.derivativeUrls.preview, previewBytes!, 'image/jpeg', derivatives.preview.md5);
    await call('POST', `/media/${id}/previews`);
  }
  if (plan.mode === 'done') return id;
  if (plan.mode === 'single' && plan.url) {
    await put(plan.url, file, plan.contentType ?? contentType, md5 ?? (await md5OfBlob(file)));
  } else if (plan.mode === 'multipart' && plan.partSize) {
    const partSize = plan.partSize;
    const total = Math.ceil(file.size / partSize);
    let next = 1;
    let done = 0;
    const worker = async () => {
      while (next <= total) {
        const n = next++;
        const part = file.slice((n - 1) * partSize, Math.min(file.size, n * partSize));
        const partMd5 = md5Base64(await part.arrayBuffer());
        const { urls } = await call<{ urls: Record<number, string> }>('POST', `/media/${id}/parts`, { parts: [{ n, md5: partMd5 }] });
        const res = await fetch(urls[n], { method: 'PUT', body: part, headers: { 'content-md5': partMd5 } });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        progress(++done / total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
  } else {
    throw new Error('This video can’t be added from a browser. Use the Lens app.');
  }
  await call('POST', `/media/${id}/complete`);
  return id;
}

const input = $('event-files') as HTMLInputElement;
input.addEventListener('change', async () => {
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length) return;
  const isVideo = (f: File) => VIDEO_TYPES.includes(f.type) || /\.(mp4|m4v|mov)$/i.test(f.name);
  const usable = files
    .filter((f) => f.size > 0 && (isVideo(f) ? f.size <= MAX_VIDEO_BYTES : TYPES.includes(f.type) && f.size <= MAX_BYTES))
    .slice(0, MAX_FILES);
  const skipped = files.length - usable.length;
  if (!usable.length) {
    say('Choose photos (JPEG, PNG, WebP or HEIC, up to 16 MB each) or videos (MP4 or MOV, up to 2 GB).', true);
    return;
  }
  const label = $('event-add');
  label.classList.add('busy');
  try {
    say('Getting ready…');
    const name = await ensureSession();
    await call('POST', `/events/${code}/join`);
    const added: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < usable.length; i++) {
      say(`Adding ${i + 1} of ${usable.length}…`);
      try {
        const f = usable[i];
        added.push(
          isVideo(f)
            ? await uploadVideo(f, (x) => say(`Adding ${i + 1} of ${usable.length} (video ${Math.round(x * 100)}%)… keep this page open.`))
            : await uploadPhoto(f),
        );
      } catch (error) {
        failed.push(`${usable[i].name}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
    // Into the album in batches (the API takes up to 100 at a time).
    for (let i = 0; i < added.length; i += 100) await call('POST', `/events/${code}/items`, { mediaIds: added.slice(i, i + 100) });
    const notes = [
      added.length ? `Added ${added.length} as ${name}.` : '',
      skipped ? `${skipped} skipped (photos up to 16 MB, videos up to 2 GB; ${MAX_FILES} at a time).` : '',
      failed.length ? `Not added: ${failed.join('; ')}` : '',
    ].filter(Boolean);
    say(notes.join(' '), !added.length);
    if (added.length) {
      $('event-keep').hidden = false;
      await load().catch(() => {});
    }
  } catch (error) {
    say(error instanceof Error ? error.message : 'Something went wrong', true);
  } finally {
    label.classList.remove('busy');
  }
});

// Report link → contact form with this page's address (Play UGC policy: reporting for everyone who can see it).
const reportLink = document.getElementById('event-report') as HTMLAnchorElement | null;
if (reportLink) reportLink.href = `/contact/?topic=report&ref=${encodeURIComponent(location.origin + location.pathname)}`;
