import { GitHubStorageConnector } from './github';
import { ConnectorError, type StorageConnection, type StorageConnector } from './types';

export const STORAGE_PROVIDERS = [
  { id: 'github', name: 'GitHub', icon: '/github-mark.png', description: 'Encrypted route library backups in a private repository.' },
] as const;
export type StorageProviderId = (typeof STORAGE_PROVIDERS)[number]['id'];

/** Adapters share backup operations; authentication is provider-specific. */
export function createStorageConnector(connection: StorageConnection): StorageConnector {
  if (connection?.provider !== 'github') throw new ConnectorError('configuration');
  return new GitHubStorageConnector(connection);
}
