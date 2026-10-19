// /e/<code>/: an event album link (docs/design/switch-features.md §3).
// Anyone can see the album's previews; "Add your photos" works without the app:
// the browser gets a guest session (HttpOnly cookie, like a new phone gets a
// guest name), joins, and uploads each photo the way the app does: thumbnail +
// preview made here, every byte MD5-checked by the cloud on arrival.
import SparkMD5 from 'spark-md5';

type EventInfo = {
  event: { name: string; ownerName: string; count: number; people: number; joined: boolean; isOwner: boolean };
  items: { id: string; kind: string; thumbUrl?: string }[];
};
type Plan = { mode: 'single' | 'multipart' | 'done' | 'external'; url?: string; contentType?: string; derivativeUrls?: { thumb?: string; preview?: string } };

const API = '/api/v1';
const MAX_FILES = 50;
const MAX_BYTES = 16 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

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
    ? `intent://e/${code}#Intent;scheme=lens;package=com.akshay.lens;S.browser_fallback_url=${encodeURIComponent(location.origin + '/download/')};end`
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

const input = $('event-files') as HTMLInputElement;
input.addEventListener('change', async () => {
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length) return;
  const usable = files.filter((f) => TYPES.includes(f.type) && f.size > 0 && f.size <= MAX_BYTES).slice(0, MAX_FILES);
  const skipped = files.length - usable.length;
  if (!usable.length) {
    say('Choose photos (JPEG, PNG, WebP or HEIC, up to 16 MB each). Videos: use the Lens app.', true);
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
        added.push(await uploadPhoto(usable[i]));
      } catch (error) {
        failed.push(`${usable[i].name}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
    // Into the album in batches (the API takes up to 100 at a time).
    for (let i = 0; i < added.length; i += 100) await call('POST', `/events/${code}/items`, { mediaIds: added.slice(i, i + 100) });
    const notes = [
      added.length ? `Added ${added.length} ${added.length === 1 ? 'photo' : 'photos'} as ${name}.` : '',
      skipped ? `${skipped} skipped (only photos up to 16 MB; ${MAX_FILES} at a time).` : '',
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
