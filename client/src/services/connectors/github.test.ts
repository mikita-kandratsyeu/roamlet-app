import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENCRYPTED_BACKUP_MAX_BYTES } from '../../domain/encryptedBackup';
import { GitHubStorageConnector } from './github';
import { createStorageConnector } from './registry';
import { ConnectorError, type BackupEntry, type StorageConnection } from './types';

const connection: StorageConnection = {
  provider: 'github',
  owner: 'pilot-owner',
  repository: 'private-backups',
  token: 'synthetic-test-only-token',
};
const name = '12345678-1234-4123-8123-123456789abc.roamlet';
const entry: BackupEntry = { id: `roamlet-backups/${name}`, name, size: 3 };
const repo = { private: true, permissions: { push: true } };
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers });
const file = (patch = {}) => ({
  ...entry,
  path: entry.id,
  type: 'file',
  encoding: 'base64',
  content: 'AAH/\n',
  download_url: 'https://untrusted.invalid/secret',
  ...patch,
});
const service = (...responses: Response[]) => {
  const fetcher = vi.fn<typeof fetch>();
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  return { connector: new GitHubStorageConnector(connection, fetcher), fetcher };
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GitHub storage connector', () => {
  it('exports a synchronous registry and code-only error contract', () => {
    expect(createStorageConnector(connection)).toBeInstanceOf(GitHubStorageConnector);
    const error = new ConnectorError('auth');
    expect(error.message).toBe('auth');
    expect(error.code).toBe('auth');
    expect(error.cause).toBeUndefined();
  });

  it.each([
    { owner: '../escape' },
    { owner: 'https://api.github.com' },
    { owner: '-invalid' },
    { owner: 'a--b' },
    { owner: 'x'.repeat(40) },
    { repository: '..' },
    { repository: 'other/repo' },
    { repository: 'repo?ref=elsewhere' },
    { repository: 'x'.repeat(101) },
    { token: '' },
    { token: 'token\r\nheader' },
    { provider: 'other' },
  ])('validates configuration before any request: %j', (patch) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      () => new GitHubStorageConnector({ ...connection, ...patch } as StorageConnection, fetcher),
    ).toThrow(new ConnectorError('configuration'));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks private repository/push access with a fixed API and no browser credentials', async () => {
    const { connector, fetcher } = service(json(repo));
    await expect(connector.checkConnection()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/pilot-owner/private-backups',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: expect.objectContaining({ Authorization: `Bearer ${connection.token}` }),
      }),
    );
  });

  it.each(['check', 'list', 'upload', 'download'] as const)(
    'blocks public repositories for %s without a contents request',
    async (operation) => {
      const { connector, fetcher } = service(json({ ...repo, private: false }));
      const result =
        operation === 'check'
          ? connector.checkConnection()
          : operation === 'list'
            ? connector.listBackups()
            : operation === 'upload'
              ? connector.uploadBackup(new Uint8Array([1]))
              : connector.downloadBackup(entry);
      await expect(result).rejects.toMatchObject({ code: 'permission', message: 'permission' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [{ private: true, permissions: { push: false } }, 'permission'],
    [{ private: 'true', permissions: { push: true } }, 'invalid-data'],
    [{ private: true }, 'invalid-data'],
  ])('validates repository metadata and push permission', async (data, code) => {
    const { connector } = service(json(data));
    await expect(connector.checkConnection()).rejects.toMatchObject({ code });
  });

  it('rechecks privacy once per operation, even after a successful connection', async () => {
    const { connector, fetcher } = service(
      json(repo),
      json(repo),
      json([]),
      json({ private: false }),
    );
    await connector.checkConnection();
    expect(await connector.listBackups()).toEqual([]);
    await expect(connector.listBackups()).rejects.toMatchObject({ code: 'permission' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('lists only strict snapshots, accepting object representation and ignoring unrelated files', async () => {
    const { connector, fetcher } = service(
      json(repo),
      json({ entries: [file(), { name: 'README.md', type: 'file' }] }),
    );
    expect(await connector.listBackups()).toEqual([entry]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toMatch(/\/contents\/roamlet-backups$/);
  });

  it('treats only a missing folder as empty, not a missing repository', async () => {
    const missingFolder = service(json(repo), json({ secret: connection.token }, 404));
    expect(await missingFolder.connector.listBackups()).toEqual([]);
    const missingRepo = service(json({}, 404));
    await expect(missingRepo.connector.listBackups()).rejects.toMatchObject({ code: 'not-found' });
  });

  it('bounds directory listings at the documented 1,000-entry API cap', async () => {
    const full = service(json(repo), json(Array.from({ length: 1000 }, () => ({ name: 'notes' }))));
    expect(await full.connector.listBackups()).toEqual([]);
    const excessive = service(
      json(repo),
      json(Array.from({ length: 1001 }, () => ({ name: 'notes' }))),
    );
    await expect(excessive.connector.listBackups()).rejects.toMatchObject({ code: 'too-large' });
  });

  it.each([
    { path: '../outside' },
    { name: 'not-a-uuid.roamlet' },
    { type: 'symlink' },
    { type: 'dir' },
    { target: 'outside' },
    { submodule_git_url: 'https://untrusted.invalid' },
    { size: -1 },
    { size: 1.5 },
  ])('rejects invalid or non-file snapshot metadata: %j', async (patch) => {
    const { connector } = service(json(repo), json([file(patch)]));
    await expect(connector.listBackups()).rejects.toMatchObject({ code: 'invalid-data' });
  });

  it('uploads immutable unique UUID snapshots using base64 and no sha or token in the body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'GET') return json(repo);
      const path = String(url).split('/contents/')[1];
      return json({ content: file({ path, name: path.split('/')[1] }) }, 201);
    });
    const connector = new GitHubStorageConnector(connection, fetcher);
    const first = await connector.uploadBackup(new Uint8Array([0, 1, 255]));
    const second = await connector.uploadBackup(new Uint8Array([0, 1, 255]));
    expect(first.id).not.toBe(second.id);
    expect(first.name).toMatch(/^[0-9a-f-]{36}\.roamlet$/);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body).toEqual({ message: 'Create encrypted Roamlet backup', content: 'AAH/' });
    expect(body.sha).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(connection.token);
  });

  it('copies upload bytes before awaiting connection verification', async () => {
    const { connector, fetcher } = service(json(repo), json({ content: file() }, 201));
    const bytes = new Uint8Array([0, 1, 255]);
    const pending = connector.uploadBackup(bytes);
    bytes.fill(9);
    await expect(pending).rejects.toMatchObject({ code: 'invalid-data' });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).content).toBe('AAH/');
  });

  it('bounds uploads before fetching and accepts exactly 30 MiB', async () => {
    const { connector, fetcher } = service();
    await expect(
      connector.uploadBackup(new Uint8Array(ENCRYPTED_BACKUP_MAX_BYTES + 1)),
    ).rejects.toMatchObject({ code: 'too-large' });
    await expect(connector.uploadBackup(new Uint8Array())).rejects.toMatchObject({
      code: 'invalid-data',
    });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === 'GET') return json(repo);
      const path = String(url).split('/contents/')[1];
      return json(
        { content: file({ path, name: path.split('/')[1], size: ENCRYPTED_BACKUP_MAX_BYTES }) },
        201,
      );
    });
    expect((await connector.uploadBackup(new Uint8Array(ENCRYPTED_BACKUP_MAX_BYTES))).size).toBe(
      ENCRYPTED_BACKUP_MAX_BYTES,
    );
  });

  it('decodes small JSON base64 without using external download URLs', async () => {
    const { connector, fetcher } = service(json(repo), json(file()));
    expect(await connector.downloadBackup(entry)).toEqual(new Uint8Array([0, 1, 255]));
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url] of fetcher.mock.calls)
      expect(String(url)).toMatch(/^https:\/\/api\.github\.com\//);
  });

  it('uses the fixed Contents API raw representation for large files', async () => {
    const bytes = new Uint8Array(1_000_001).fill(7);
    const large = { ...entry, size: bytes.length };
    const { connector, fetcher } = service(
      json(repo),
      json(file({ size: bytes.length, encoding: 'none', content: '' })),
      new Response(bytes),
    );
    expect(await connector.downloadBackup(large)).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][0]).toBe(fetcher.mock.calls[1][0]);
    expect(fetcher.mock.calls[2][1]?.headers).toMatchObject({
      Accept: 'application/vnd.github.raw+json',
    });
  });

  it.each([
    'https://untrusted.invalid/a',
    'roamlet-backups/../outside',
    `roamlet-backups/%2e%2e/${name}`,
  ])('rejects caller-supplied unsafe paths before fetching: %s', async (id) => {
    const { connector, fetcher } = service();
    await expect(connector.downloadBackup({ ...entry, id })).rejects.toMatchObject({
      code: 'invalid-data',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { content: '!!!!' },
    { content: 'AA==' },
    { content: 'AAH=' },
    { size: 2 },
    { path: `roamlet-backups/aaaaaaaa-1234-4123-8123-123456789abc.roamlet` },
    { encoding: 'invalid' },
  ])('rejects corrupted content or mismatching metadata: %j', async (patch) => {
    const { connector } = service(json(repo), json(file(patch)));
    await expect(connector.downloadBackup(entry)).rejects.toMatchObject({ code: 'invalid-data' });
  });

  it('rejects raw size mismatches and declared over-limit bodies', async () => {
    const mismatch = service(
      json(repo),
      json(file({ encoding: 'none' })),
      new Response(new Uint8Array(2)),
    );
    await expect(mismatch.connector.downloadBackup(entry)).rejects.toMatchObject({
      code: 'invalid-data',
    });
    const declared = service(
      json(repo),
      json(file({ encoding: 'none' })),
      new Response('', { headers: { 'Content-Length': String(ENCRYPTED_BACKUP_MAX_BYTES + 1) } }),
    );
    await expect(declared.connector.downloadBackup(entry)).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('bounds raw streams without Content-Length, cancels them and accepts the exact bound', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(ENCRYPTED_BACKUP_MAX_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const { connector } = service(
      json(repo),
      json(file({ size: ENCRYPTED_BACKUP_MAX_BYTES, encoding: 'none' })),
      new Response(stream),
    );
    await expect(
      connector.downloadBackup({ ...entry, size: ENCRYPTED_BACKUP_MAX_BYTES }),
    ).rejects.toMatchObject({ code: 'too-large' });
    expect(cancel).toHaveBeenCalledTimes(1);
    const exact = service(
      json(repo),
      json(file({ size: ENCRYPTED_BACKUP_MAX_BYTES, encoding: 'none' })),
      new Response(new Uint8Array(ENCRYPTED_BACKUP_MAX_BYTES)),
    );
    expect(
      (await exact.connector.downloadBackup({ ...entry, size: ENCRYPTED_BACKUP_MAX_BYTES })).length,
    ).toBe(ENCRYPTED_BACKUP_MAX_BYTES);
  });

  it('bounds JSON streams and rejects malformed JSON/UTF-8', async () => {
    const oversized = service(new Response(new Uint8Array(8 * 1024 * 1024 + 1)));
    await expect(oversized.connector.checkConnection()).rejects.toMatchObject({
      code: 'too-large',
    });
    for (const response of [new Response('{'), new Response(new Uint8Array([255]))]) {
      await expect(service(response).connector.checkConnection()).rejects.toMatchObject({
        code: 'invalid-data',
      });
    }
  });

  it.each([
    [401, {}, 'auth'],
    [403, {}, 'permission'],
    [403, { 'x-ratelimit-remaining': '0' }, 'quota'],
    [403, { 'retry-after': '5' }, 'quota'],
    [404, {}, 'not-found'],
    [429, {}, 'quota'],
    [409, {}, 'conflict'],
    [422, {}, 'conflict'],
    [413, {}, 'too-large'],
    [500, {}, 'network'],
    [400, {}, 'invalid-data'],
  ] as const)(
    'normalizes HTTP %s without leaking errors/headers or retrying',
    async (status, headers, code) => {
      const { connector, fetcher } = service(json({ message: connection.token }, status, headers));
      await expect(connector.checkConnection()).rejects.toMatchObject({ code, message: code });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('normalizes raw network errors without retaining causes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(connection.token));
    await expect(
      new GitHubStorageConnector(connection, fetcher).checkConnection(),
    ).rejects.toMatchObject({ code: 'network', message: 'network' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves pre-cancellation without a request', async () => {
    const { connector, fetcher } = service();
    const controller = new AbortController();
    controller.abort(new Error(connection.token));
    await expect(connector.checkConnection(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Request cancelled',
    });
    await expect(
      connector.uploadBackup(new Uint8Array([1]), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(connector.downloadBackup(entry, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['fetch', 'body'] as const)(
    'preserves user cancellation during %s even if the transport hangs',
    async (stage) => {
      const stream = new ReadableStream<Uint8Array>({});
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(() =>
          stage === 'fetch' ? new Promise(() => {}) : Promise.resolve(new Response(stream)),
        );
      const controller = new AbortController();
      const pending = new GitHubStorageConnector(connection, fetcher).checkConnection(
        controller.signal,
      );
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'AbortError',
        message: 'Request cancelled',
      });
      await Promise.resolve();
      controller.abort(new Error(connection.token));
      await assertion;
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    },
  );

  it.each(['fetch', 'body'] as const)(
    'applies the 20-second deadline to %s and cleans timers',
    async (stage) => {
      vi.useFakeTimers();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(() =>
          stage === 'fetch'
            ? new Promise(() => {})
            : Promise.resolve(new Response(new ReadableStream<Uint8Array>({}))),
        );
      const pending = new GitHubStorageConnector(connection, fetcher).checkConnection();
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'timeout',
        message: 'timeout',
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('does not reset the deadline when headers arrive', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 19_000));
      return new Response(new ReadableStream<Uint8Array>({}));
    });
    const pending = new GitHubStorageConnector(connection, fetcher).checkConnection();
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
