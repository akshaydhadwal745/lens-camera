// WebDAV connector: Nextcloud, ownCloud, Synology/QNAP NAS, any WebDAV server.
// Files go into the folder URL the user gives (created if missing). Uploads
// are a single PUT (most servers don't support resuming); we verify the stored
// size, and the MD5 when the server reports checksums (Nextcloud/ownCloud).
// No trash: deleting in Lens keeps the file until "Delete forever".
import { UploadType } from 'expo-file-system';

import { base64 } from './hashes';
import { Auth, Connector, SignedOut, StorageFull, UploadCancelled } from './types';

export type WebDavConfig = { url: string; username: string };

function setup(auth: Auth) {
  const config = auth.config as WebDavConfig;
  const password = (JSON.parse(auth.secret ?? '{}') as { password?: string }).password ?? '';
  const folder = config.url.endsWith('/') ? config.url : `${config.url}/`;
  const authorization = `Basic ${base64(new TextEncoder().encode(`${config.username}:${password}`))}`;
  return { config, folder, authorization, fileUrl: (name: string) => folder + encodeURIComponent(name) };
}

function check(status: number, what: string) {
  if (status === 401 || status === 403) throw new SignedOut('Your storage rejected the user name or password');
  if (status === 507) throw new StorageFull();
  throw new Error(`Storage ${what} failed (status ${status})`);
}

const PROPS = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop>
<d:quota-available-bytes/><d:quota-used-bytes/><d:getcontentlength/><oc:checksums/></d:prop></d:propfind>`;

/** Text of a property, whatever namespace prefix the server uses (d:, D:, ns0:, none…). */
function prop(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)<`, 'i'))?.[1];
}

async function propfind(s: ReturnType<typeof setup>, url: string) {
  const res = await fetch(url, { method: 'PROPFIND', headers: { Authorization: s.authorization, Depth: '0', 'Content-Type': 'application/xml' }, body: PROPS });
  return { status: res.status, xml: res.ok ? await res.text() : '' };
}

export const webdav: Connector = {
  provider: 'webdav',

  async account(auth) {
    const s = setup(auth);
    let found = await propfind(s, s.folder);
    if (found.status === 404) {
      const made = await fetch(s.folder, { method: 'MKCOL', headers: { Authorization: s.authorization } });
      if (!made.ok && made.status !== 405) check(made.status, 'folder creation');
      found = await propfind(s, s.folder);
    }
    if (found.status !== 207) check(found.status, 'connection test');
    return { account: `${s.config.username} · ${new URL(s.folder).host}`, quota: await this.quota(auth) };
  },

  async quota(auth) {
    const s = setup(auth);
    const { status, xml } = await propfind(s, s.folder);
    if (status !== 207) check(status, 'storage check');
    const free = Number(prop(xml, 'quota-available-bytes'));
    const used = Number(prop(xml, 'quota-used-bytes'));
    // Negative / missing = unlimited or unknown.
    if (!Number.isFinite(free) || free < 0 || !Number.isFinite(used)) return {};
    return { usedBytes: used, totalBytes: used + free };
  },

  async upload(auth, job) {
    const s = setup(auth);
    if (job.isCancelled()) throw new UploadCancelled();
    const md5 = job.md5Hex().toLowerCase();
    const url = s.fileUrl(job.name);
    const result = await job.file.upload(url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      // Nextcloud/ownCloud store (and report) the checksum we declare.
      headers: { Authorization: s.authorization, 'Content-Type': job.contentType, 'OC-Checksum': `MD5:${md5}` },
      onProgress: ({ bytesSent }) => job.onProgress(bytesSent),
    });
    if (result.status < 200 || result.status >= 300) check(result.status, 'upload');

    const { status, xml } = await propfind(s, url);
    if (status !== 207) check(status, 'upload check');
    const size = Number(prop(xml, 'getcontentlength'));
    const checksums = prop(xml, 'checksums') ?? prop(xml, 'checksum') ?? '';
    const reported = checksums.match(/MD5:([0-9a-f]{32})/i)?.[1]?.toLowerCase();
    if (size !== job.size || (reported && reported !== md5)) {
      await fetch(url, { method: 'DELETE', headers: { Authorization: s.authorization } }).catch(() => {});
      throw new Error('The storage saved a different file than we sent. It will be uploaded again.');
    }
    return { ref: job.name, checksum: reported ? `md5:${md5}` : `size:${job.size}` };
  },

  async source(auth, ref) {
    const s = setup(auth);
    return { uri: s.fileUrl(ref), headers: { Authorization: s.authorization } };
  },

  async trash() {
    // No standard trash in WebDAV: the file stays until "Delete forever".
  },

  async untrash() {},

  async remove(auth, ref) {
    const s = setup(auth);
    const res = await fetch(s.fileUrl(ref), { method: 'DELETE', headers: { Authorization: s.authorization } });
    if (!res.ok && res.status !== 404) check(res.status, 'delete');
  },
};
