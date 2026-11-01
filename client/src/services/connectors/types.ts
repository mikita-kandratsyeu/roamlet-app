export interface GitHubStorageConnection {
  provider: 'github';
  owner: string;
  repository: string;
}
export interface GoogleDriveStorageConnection {
  provider: 'google-drive';
}
export type StorageConnection = GitHubStorageConnection | GoogleDriveStorageConnection;

export type ConnectorErrorCode =
  | 'configuration'
  | 'unavailable'
  | 'auth'
  | 'permission'
  | 'not-found'
  | 'quota'
  | 'network'
  | 'timeout'
  | 'invalid-data'
  | 'too-large'
  | 'conflict';

export class ConnectorError extends Error {
  constructor(readonly code: ConnectorErrorCode) {
    super(code);
    this.name = 'ConnectorError';
  }
}

export interface BackupEntry {
  /** Strict provider-relative snapshot path, never a URL. */
  id: string;
  name: string;
  size: number;
}

export interface StorageConnector {
  checkConnection(signal?: AbortSignal): Promise<void>;
  listBackups(signal?: AbortSignal): Promise<BackupEntry[]>;
  /** Cancellation/network failure can leave a committed snapshot; no automatic retries. */
  uploadBackup(data: Uint8Array, signal?: AbortSignal): Promise<BackupEntry>;
  downloadBackup(entry: BackupEntry, signal?: AbortSignal): Promise<Uint8Array>;
}
