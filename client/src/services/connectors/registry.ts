import { GitHubStorageConnector } from './github';
import { ConnectorError, type StorageConnection, type StorageConnector } from './types';

/** Dispose of the connector and connection on disconnect to release the in-memory PAT. */
export function createStorageConnector(connection: StorageConnection): StorageConnector {
  if (connection?.provider !== 'github') throw new ConnectorError('configuration');
  return new GitHubStorageConnector(connection);
}
