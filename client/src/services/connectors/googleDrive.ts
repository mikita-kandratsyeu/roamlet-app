import { connectorJson, connectorRequest, CONNECTOR_TRANSPORT_MAX_BYTES } from './http';
import {
  ConnectorError,
  type BackupEntry,
  type GoogleDriveStorageConnection,
  type StorageConnector,
} from './types';
const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.roamlet$/;
function backupEntry(value: unknown): BackupEntry {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(value.id) ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !NAME.test(value.name) ||
    !('size' in value) ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size < 52
  )
    throw new ConnectorError('invalid-data');
  if (value.size > CONNECTOR_TRANSPORT_MAX_BYTES) throw new ConnectorError('too-large');
  return { id: value.id, name: value.name, size: value.size };
}
export class GoogleDriveStorageConnector implements StorageConnector {
  constructor(connection: GoogleDriveStorageConnection) {
    if (connection?.provider !== 'google-drive') throw new ConnectorError('configuration');
  }
  async checkConnection(signal?: AbortSignal): Promise<void> {
    await connectorJson('google-drive', 'check', {}, signal);
  }
  async listBackups(signal?: AbortSignal): Promise<BackupEntry[]> {
    const value = await connectorJson('google-drive', 'list', {}, signal);
    if (!Array.isArray(value.backups) || value.backups.length > 1000)
      throw new ConnectorError('invalid-data');
    const entries = value.backups.map(backupEntry);
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      throw new ConnectorError('invalid-data');
    return entries;
  }
  async uploadBackup(data: Uint8Array, signal?: AbortSignal): Promise<BackupEntry> {
    if (!(data instanceof Uint8Array) || data.length < 52) throw new ConnectorError('invalid-data');
    if (data.length > CONNECTOR_TRANSPORT_MAX_BYTES) throw new ConnectorError('too-large');
    const bytes = await connectorRequest('google-drive', 'upload', {}, signal, data);
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ConnectorError('invalid-data');
    }
    if (!value || typeof value !== 'object' || !('backup' in value))
      throw new ConnectorError('invalid-data');
    const entry = backupEntry(value.backup);
    if (entry.size !== data.length) throw new ConnectorError('invalid-data');
    return entry;
  }
  async downloadBackup(entry: BackupEntry, signal?: AbortSignal): Promise<Uint8Array> {
    const expected = backupEntry(entry);
    const bytes = await connectorRequest(
      'google-drive',
      'download',
      { id: expected.id, size: String(expected.size) },
      signal,
    );
    if (bytes.length !== expected.size) throw new ConnectorError('invalid-data');
    return bytes;
  }
}
