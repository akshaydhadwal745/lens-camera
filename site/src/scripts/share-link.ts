// /s/<token>/: a share link (docs/features/share-links.md). Shows what was
// shared (previews; videos play the location-safe original), and hands the
// link to the app: "Open in Lens" when it's installed, "Get Lens" otherwise.
// Both copy the link first, so a fresh website install finds it on its first
// launch (the app reads the clipboard once); Play installs also get it through
// the install referrer (getUrl).

type LinkInfo = {
  link: {
    from: { name: string; realName: string | null };
    count: number;
    photos: number;
    videos: number;
    mode: 'anyone' | 'one';
    status: 'active' | 'expired' | 'revoked' | 'used';
    expiresAt: number;
    getUrl: string;
  };
  items: { id: string; kind: string; previewUrl?: string; thumbUrl?: string; url?: string; width?: number; height?: number }[];
};

const token = location.pathname.split('/')[2] ?? '';
const valid = /^[A-Za-z0-9_-]{22}$/.test(token);
const $ = (id: string) => document.getElementById(id)!;
const android = /Android/i.test(navigator.userAgent);
const iphone = /iPhone|iPad/i.test(navigator.userAgent);
const shareUrl = `${location.origin}/s/${token}`;

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function what(l: LinkInfo['link']): string {
  const parts = [l.photos ? plural(l.photos, 'photo') : '', l.videos ? plural(l.videos, 'video') : ''].filter(Boolean);
  return parts.join(' and ') || plural(l.count, 'item');
}

function broken(title: string, text: string) {
  $('share-title').textContent = title;
  const meta = $('share-meta');
  meta.textContent = text;
  meta.classList.add('status-error');
}

/** Copies the link (so the app finds it after installing); never blocks the tap if the browser refuses. */
async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl);
  } catch {
    const area = document.createElement('textarea');
    area.value = shareUrl;
    area.setAttribute('readonly', '');
    area.className = 'sr-only';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch {
      // Nothing more to try: the app also accepts the link pasted by hand.
    }
    area.remove();
  }
}

function wireButtons(getUrl: string) {
  const open = $('open-app') as HTMLAnchorElement;
  const get = $('get-app') as HTMLAnchorElement;
  const fallback = new URL(getUrl, location.origin).toString();
  open.href = android
    ? `intent://s/${token}#Intent;scheme=lens;package=com.instagrowapp.lens;S.browser_fallback_url=${encodeURIComponent(fallback)};end`
    : `lens://s/${token}`;
  get.href = getUrl;
  for (const a of [open, get]) {
    a.addEventListener('click', (event) => {
      event.preventDefault();
      void copyLink().finally(() => {
        location.href = a.href;
      });
    });
  }
  $('share-bar').hidden = iphone; // no iPhone app to get yet: the page itself is the fallback
  $('share-iphone').hidden = !iphone;
  $('share-after').hidden = iphone;
}

function render(info: LinkInfo) {
  const l = info.link;
  const sender = l.from.realName ? `${l.from.realName} (${l.from.name})` : l.from.name;
  if (l.status === 'revoked') return broken('This link was turned off', `${sender} stopped sharing it. Ask them for a new one.`);
  if (l.status === 'expired') return broken('This link has expired', `Ask ${sender} to send a new one.`);
  if (l.status === 'used') return broken('Already opened', 'This link was for one person and it was already opened in Lens.');

  $('share-title').textContent = `${l.from.realName ?? l.from.name} shared ${what(l)} with you`;
  const days = Math.max(1, Math.ceil((l.expiresAt - Date.now()) / 86400000));
  $('share-meta').textContent = `${l.from.realName ? `Lens name ${l.from.name} · ` : ''}Link works for ${plural(days, 'more day')}`;
  wireButtons(l.getUrl);
  if (l.mode === 'one') {
    $('share-private').hidden = false;
    return;
  }

  const feed = $('share-feed');
  for (const item of info.items) {
    const figure = document.createElement('figure');
    if (item.kind === 'video' && item.url) {
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      if (item.previewUrl) video.poster = item.previewUrl;
      video.src = item.url;
      figure.appendChild(video);
    } else if (item.previewUrl || item.thumbUrl) {
      const img = document.createElement('img');
      img.src = item.previewUrl ?? item.thumbUrl!;
      img.alt = item.kind === 'video' ? 'Video' : 'Photo';
      img.loading = 'lazy';
      img.decoding = 'async';
      if (item.width && item.height) {
        img.width = item.width;
        img.height = item.height;
      }
      figure.appendChild(img);
    } else continue;
    if (item.url) {
      const caption = document.createElement('figcaption');
      const save = document.createElement('a');
      save.href = item.url;
      save.download = '';
      save.rel = 'noopener';
      save.textContent = item.kind === 'video' ? 'Save video' : 'Save photo';
      caption.appendChild(save);
      figure.appendChild(caption);
    }
    feed.appendChild(figure);
  }
}

async function load() {
  if (!valid) return broken('This link doesn’t work', 'Check that you copied all of it, or ask for a new one.');
  try {
    const res = await fetch(`/api/v1/links/${token}`, { credentials: 'same-origin', headers: { 'x-lens-web': '1' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return broken('This link doesn’t work', (data as { error?: string }).error ?? 'Ask whoever sent it for a new one.');
    render(data as LinkInfo);
  } catch {
    broken('Couldn’t load', 'Check your connection and try again.');
  }
}

void load();

// Report link → contact form with this page's address (Play UGC policy: reporting for everyone who can see it).
const reportLink = document.getElementById('share-report') as HTMLAnchorElement | null;
if (reportLink) reportLink.href = `/contact/?topic=report&ref=${encodeURIComponent(location.origin + location.pathname)}`;
