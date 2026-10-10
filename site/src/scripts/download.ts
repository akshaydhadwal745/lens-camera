// Fills the download page from /downloads/android/latest.json (promoted build).
type File = { url: string; size: number; sha256: string };
type Latest = { build: number; files: Partial<Record<'arm64-v8a' | 'armeabi-v7a', File>> };

const root = document.getElementById('download');
if (root) {
  const t = JSON.parse(root.dataset.i18n ?? '{}') as Record<string, string>;
  const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
  const mb = (bytes: number) => `${(bytes / 1e6).toFixed(0)} MB`;
  const main = document.getElementById('apk-64') as HTMLAnchorElement;
  const older = document.getElementById('apk-32') as HTMLAnchorElement;
  const version = document.getElementById('apk-version') as HTMLElement;
  const sha = document.getElementById('apk-sha') as HTMLElement;
  fetch('/downloads/android/latest.json', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<Latest>) : Promise.reject(new Error(String(r.status)))))
    .then((latest) => {
      const a64 = latest.files['arm64-v8a'];
      const a32 = latest.files['armeabi-v7a'];
      if (!a64) throw new Error('no 64-bit file');
      main.href = a64.url;
      main.removeAttribute('aria-disabled');
      version.textContent = fill(t.version, { build: `dev-${latest.build}`, size: mb(a64.size) });
      sha.textContent = fill(t.checksum, { sha: a64.sha256 });
      if (a32) {
        older.href = a32.url;
        older.hidden = false;
      }
    })
    .catch(() => {
      version.textContent = t.unavailable;
    });
}
