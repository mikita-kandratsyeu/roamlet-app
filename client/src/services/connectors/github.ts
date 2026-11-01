import { ENCRYPTED_BACKUP_MAX_BYTES } from '../../domain/encryptedBackup';
import {
  ConnectorError,
  type BackupEntry,
  type StorageConnection,
  type StorageConnector,
} from './types';

const API = 'https://api.github.com';
const FOLDER = 'roamlet-backups';
const SNAPSHOT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.roamlet$/;
const JSON_MAX_BYTES = 8 * 1024 * 1024;
const SMALL_FILE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 20_000;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConnectorError('invalid-data');
  return value as Record<string, unknown>;
}

function checkSize(size: unknown): asserts size is number {
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0)
    throw new ConnectorError('invalid-data');
  if (size > ENCRYPTED_BACKUP_MAX_BYTES) throw new ConnectorError('too-large');
}

function checkEntry(entry: BackupEntry): void {
  if (
    !entry ||
    typeof entry.name !== 'string' ||
    !SNAPSHOT.test(entry.name) ||
    entry.id !== `${FOLDER}/${entry.name}`
  )
    throw new ConnectorError('invalid-data');
  checkSize(entry.size);
}

function fileEntry(value: unknown): BackupEntry {
  const file = object(value);
  if (
    file.type !== 'file' ||
    'target' in file ||
    'submodule_git_url' in file ||
    typeof file.path !== 'string' ||
    typeof file.name !== 'string'
  )
    throw new ConnectorError('invalid-data');
  checkSize(file.size);
  const entry = { id: file.path, name: file.name, size: file.size };
  checkEntry(entry);
  return entry;
}

function cancelled(): DOMException {
  return new DOMException('Request cancelled', 'AbortError');
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(chunks.join(''));
}

function decodeBase64(content: unknown, size: number): Uint8Array {
  if (typeof content !== 'string') throw new ConnectorError('invalid-data');
  const encoded = content.replace(/[\r\n]/g, '');
  if (
    encoded.length !== 4 * Math.ceil(size / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  )
    throw new ConnectorError('invalid-data');
  try {
    const binary = atob(encoded);
    if (binary.length !== size || btoa(binary) !== encoded)
      throw new ConnectorError('invalid-data');
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ConnectorError('invalid-data');
  }
}

/**
 * Browser-direct pilot for a dedicated PRIVATE repository with Contents read/write PAT access.
 * Every operation rechecks privacy and push permission (not cached). GitHub's directory Contents
 * API caps listings at 1,000 entries; a full page may be truncated, and this pilot does not paginate
 * with Trees. Repository privacy can change after verification; that race is not transactional.
 * https://docs.github.com/en/rest/repos/contents#get-repository-content
 */
export class GitHubStorageConnector implements StorageConnector {
  private readonly repositoryPath: string;
  private readonly token: string;

  constructor(
    connection: StorageConnection,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {
    if (
      connection?.provider !== 'github' ||
      typeof connection.owner !== 'string' ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(connection.owner) ||
      connection.owner.includes('--') ||
      typeof connection.repository !== 'string' ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(connection.repository) ||
      ['.', '..'].includes(connection.repository) ||
      typeof connection.token !== 'string' ||
      !/^[\x21-\x7e]{1,1024}$/.test(connection.token)
    )
      throw new ConnectorError('configuration');
    this.repositoryPath = `/repos/${connection.owner}/${connection.repository}`;
    this.token = connection.token;
  }

  private async request(
    path: string,
    signal: AbortSignal | undefined,
    raw = false,
    body?: string,
  ): Promise<Uint8Array> {
    if (signal?.aborted) throw cancelled();
    const controller = new AbortController();
    let timedOut = false;
    let rejectAbort: (error: Error) => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const cancel = () => {
      rejectAbort(cancelled());
      controller.abort();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      rejectAbort(new ConnectorError('timeout'));
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const maxBytes = raw ? ENCRYPTED_BACKUP_MAX_BYTES : JSON_MAX_BYTES;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await Promise.race([
        this.fetcher(`${API}${this.repositoryPath}${path}`, {
          method: body === undefined ? 'GET' : 'PUT',
          headers: {
            Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github.object+json',
            Authorization: `Bearer ${this.token}`,
            'X-GitHub-Api-Version': '2026-03-10',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body,
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
        }),
        aborted,
      ]);
      if (!response.ok) {
        const status = response.status;
        if (status === 401) throw new ConnectorError('auth');
        if (
          status === 429 ||
          (status === 403 &&
            (response.headers.get('x-ratelimit-remaining') === '0' ||
              response.headers.has('retry-after')))
        )
          throw new ConnectorError('quota');
        if (status === 403) throw new ConnectorError('permission');
        if (status === 404) throw new ConnectorError('not-found');
        if (status === 409 || status === 422) throw new ConnectorError('conflict');
        if (status === 413) throw new ConnectorError('too-large');
        throw new ConnectorError(status >= 500 ? 'network' : 'invalid-data');
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) throw new ConnectorError('too-large');
      if (!response.body) throw new ConnectorError('invalid-data');
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        length += part.value.byteLength;
        if (length > maxBytes) throw new ConnectorError('too-large');
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    } catch (error) {
      controller.abort();
      if (signal?.aborted) throw cancelled();
      if (timedOut) throw new ConnectorError('timeout');
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError('network');
    } finally {
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  private async json(path: string, signal?: AbortSignal, body?: string): Promise<unknown> {
    const bytes = await this.request(path, signal, false, body);
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new ConnectorError('invalid-data');
    }
  }

  async checkConnection(signal?: AbortSignal): Promise<void> {
    const repo = object(await this.json('', signal));
    if (typeof repo.private !== 'boolean') throw new ConnectorError('invalid-data');
    if (!repo.private) throw new ConnectorError('permission');
    const permissions = object(repo.permissions);
    if (permissions.push !== true) throw new ConnectorError('permission');
  }

  async listBackups(signal?: AbortSignal): Promise<BackupEntry[]> {
    await this.checkConnection(signal);
    let data: unknown;
    try {
      data = await this.json(`/contents/${FOLDER}`, signal);
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'not-found') return [];
      throw error;
    }
    const entries = Array.isArray(data) ? data : object(data).entries;
    if (!Array.isArray(entries)) throw new ConnectorError('invalid-data');
    if (entries.length > 1000) throw new ConnectorError('too-large');
    const backups: BackupEntry[] = [];
    for (const value of entries) {
      const file = object(value);
      if (typeof file.name !== 'string') throw new ConnectorError('invalid-data');
      if (!file.name.endsWith('.roamlet')) continue;
      backups.push(fileEntry(file));
    }
    return backups;
  }

  async uploadBackup(data: Uint8Array, signal?: AbortSignal): Promise<BackupEntry> {
    if (signal?.aborted) throw cancelled();
    if (!(data instanceof Uint8Array)) throw new ConnectorError('invalid-data');
    checkSize(data.byteLength);
    const snapshot = new Uint8Array(data);
    await this.checkConnection(signal);
    let name: string;
    let content: string;
    try {
      name = `${crypto.randomUUID()}.roamlet`;
      content = encodeBase64(snapshot);
    } catch {
      throw new ConnectorError('invalid-data');
    }
    const entry = { id: `${FOLDER}/${name}`, name, size: snapshot.length };
    checkEntry(entry);
    // Omitting sha creates only; a UUID collision must not overwrite an existing snapshot.
    const result = object(
      await this.json(
        `/contents/${entry.id}`,
        signal,
        JSON.stringify({ message: 'Create encrypted Roamlet backup', content }),
      ),
    );
    const saved = fileEntry(result.content);
    if (saved.id !== entry.id || saved.size !== entry.size)
      throw new ConnectorError('invalid-data');
    return saved;
  }

  async downloadBackup(entry: BackupEntry, signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) throw cancelled();
    checkEntry(entry);
    const expected = { ...entry };
    await this.checkConnection(signal);
    const file = object(await this.json(`/contents/${expected.id}`, signal));
    const actual = fileEntry(file);
    if (actual.id !== expected.id || actual.size !== expected.size)
      throw new ConnectorError('invalid-data');
    if (actual.size <= SMALL_FILE_BYTES && file.encoding === 'base64')
      return decodeBase64(file.content, actual.size);
    // 1–100 MB files require raw/object representations; never follow download_url or redirects.
    if (file.encoding !== 'none' && file.encoding !== 'base64')
      throw new ConnectorError('invalid-data');
    const bytes = await this.request(`/contents/${actual.id}`, signal, true);
    if (bytes.length !== actual.size) throw new ConnectorError('invalid-data');
    return bytes;
  }
}
