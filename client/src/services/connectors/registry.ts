import { GitHubStorageConnector } from './github';
import { GoogleDriveStorageConnector } from './googleDrive';
import { ConnectorError, type StorageConnection, type StorageConnector } from './types';

export const STORAGE_PROVIDERS = [
  {
    id: 'google-drive',
    name: 'Google Drive',
    icon: '/google-drive-2026.png',
    description:
      'Encrypted library backups in your Google Drive, with access only to Roamlet data.',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: '/github-mark.png',
    description: 'Encrypted route library backups in a private repository.',
  },
] as const;
export type StorageProviderId = (typeof STORAGE_PROVIDERS)[number]['id'];

/** Adapters share backup operations; authentication is provider-specific. */
export function createStorageConnector(connection: StorageConnection): StorageConnector {
  if (connection?.provider === 'github') return new GitHubStorageConnector(connection);
  if (connection?.provider === 'google-drive') return new GoogleDriveStorageConnector(connection);
  throw new ConnectorError('configuration');
}
