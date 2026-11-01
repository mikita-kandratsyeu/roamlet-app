import {
  ConnectorError,
  type BackupEntry,
  type StorageConnection,
  type StorageConnector,
} from './types';
import { githubJson, githubRequest, GITHUB_TRANSPORT_MAX_BYTES } from './githubSession';

const SNAPSHOT =
  /^roamlet-backups\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.roamlet$/;
function entry(value: unknown): BackupEntry {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !SNAPSHOT.test(value.id) ||
    !('name' in value) ||
    value.name !== value.id.split('/')[1] ||
    !('size' in value) ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0
  )
    throw new ConnectorError('invalid-data');
  if (value.size > GITHUB_TRANSPORT_MAX_BYTES) throw new ConnectorError('too-large');
  return { id: value.id, name: value.name, size: value.size };
}
export class GitHubStorageConnector implements StorageConnector {
  private readonly params: Record<string, string>;
  constructor(connection: Extract<StorageConnection, { provider: 'github' }>) {
    if (
      connection.provider !== 'github' ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(connection.owner) ||
      connection.owner.includes('--') ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(connection.repository) ||
      ['.', '..'].includes(connection.repository)
    )
      throw new ConnectorError('configuration');
    this.params = { owner: connection.owner, repository: connection.repository };
  }
  async checkConnection(signal?: AbortSignal): Promise<void> {
    await githubJson('check', this.params, signal);
  }
  async listBackups(signal?: AbortSignal): Promise<BackupEntry[]> {
    const value = await githubJson('list', this.params, signal);
    if (!Array.isArray(value.backups) || value.backups.length >= 1000)
      throw new ConnectorError('invalid-data');
    const entries = value.backups.map(entry);
    if (new Set(entries.map((item) => item.id)).size !== entries.length)
      throw new ConnectorError('invalid-data');
    return entries;
  }
  async uploadBackup(data: Uint8Array, signal?: AbortSignal): Promise<BackupEntry> {
    if (data.length <= 0) throw new ConnectorError('invalid-data');
    if (data.length > GITHUB_TRANSPORT_MAX_BYTES) throw new ConnectorError('too-large');
    const bytes = await githubRequest('upload', this.params, signal, data);
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ConnectorError('invalid-data');
    }
    if (!value || typeof value !== 'object' || !('backup' in value))
      throw new ConnectorError('invalid-data');
    const result = entry(value.backup);
    if (result.size !== data.length) throw new ConnectorError('invalid-data');
    return result;
  }
  async downloadBackup(backup: BackupEntry, signal?: AbortSignal): Promise<Uint8Array> {
    const expected = entry(backup);
    const bytes = await githubRequest(
      'download',
      { ...this.params, id: expected.id, size: String(expected.size) },
      signal,
    );
    if (bytes.length !== expected.size) throw new ConnectorError('invalid-data');
    return bytes;
  }
}
