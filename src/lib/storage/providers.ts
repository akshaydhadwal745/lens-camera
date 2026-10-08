// Storages a user can connect. Connect shows when the app has the connector
// and the server has the provider's credentials (GET /oauth/providers).
import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { ProviderId } from '../types';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  icon: IconName;
  /** One line shown under the name. */
  blurb: string;
  /** Why it isn't available yet (shown instead of Connect). */
  unavailable?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'gdrive', name: 'Google Drive', icon: 'logo-google', blurb: '15 GB free with every Google account' },
  { id: 'onedrive', name: 'OneDrive', icon: 'logo-microsoft', blurb: '5 GB free, 1 TB with Microsoft 365' },
  { id: 'dropbox', name: 'Dropbox', icon: 'logo-dropbox', blurb: '2 GB free' },
  { id: 'box', name: 'Box', icon: 'cube-outline', blurb: '10 GB free (files up to 250 MB on free plans)' },
  {
    id: 's3',
    name: 'S3-compatible',
    icon: 'server-outline',
    blurb: 'Backblaze B2, Wasabi, Cloudflare R2, MinIO…',
  },
  { id: 'webdav', name: 'WebDAV / NAS', icon: 'folder-open-outline', blurb: 'Nextcloud, ownCloud, Synology, QNAP…' },
  {
    id: 'icloud',
    name: 'iCloud Drive',
    icon: 'logo-apple',
    blurb: 'Saves into your iCloud from the iPhone',
    unavailable: 'Coming later',
  },
];

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;
