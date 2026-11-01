import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GoogleDriveStorageConnector } from './googleDrive';
import { createStorageConnector, STORAGE_PROVIDERS } from './registry';
import { getGoogleDriveSession, logoutGoogleDrive } from './googleDriveSession';
import { CONNECTOR_TRANSPORT_MAX_BYTES, connectorRequest } from './http';
const config = { provider: 'google-drive' as const };
const entry = {
  id: 'synthetic_file_123',
  name: '11111111-1111-4111-8111-111111111111.roamlet',
  size: 52,
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('places Drive before GitHub and constructs its independent adapter', () => {
  expect(STORAGE_PROVIDERS.map((item) => item.id)).toEqual(['google-drive', 'github']);
  expect(createStorageConnector(config)).toBeInstanceOf(GoogleDriveStorageConnector);
});
it('uses only same-origin HttpOnly cookie authentication without tokens in request bodies', async () => {
  fetcher.mockResolvedValue(json({}));
  await createStorageConnector(config).checkConnection();
  expect(fetcher.mock.calls[0]).toEqual([
    '/api/google-drive?action=check',
    expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      method: 'GET',
    }),
  ]);
  expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
});
it('validates account metadata without exposing provider tokens', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      available: true,
      connected: true,
      email: 'user@example.test',
      accountId: '123456',
      access_token: 'synthetic-private',
    }),
  );
  expect(await getGoogleDriveSession()).toEqual({
    available: true,
    connected: true,
    email: 'user@example.test',
    accountId: '123456',
  });
  fetcher.mockResolvedValueOnce(json({ available: true, connected: true }));
  await expect(getGoogleDriveSession()).rejects.toMatchObject({ code: 'invalid-data' });
  fetcher.mockResolvedValueOnce(json({ available: false, connected: false }));
  expect(await getGoogleDriveSession()).toMatchObject({ available: false, connected: false });
});
it('uploads encrypted bytes through CSRF-protected same-origin POST and verifies returned size', async () => {
  fetcher.mockResolvedValueOnce(json({ backup: entry }));
  const bytes = new Uint8Array(52).fill(1);
  expect(await createStorageConnector(config).uploadBackup(bytes)).toEqual(entry);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Roamlet-Request': '1' },
  });
  expect(new Uint8Array(fetcher.mock.calls[0][1]?.body as ArrayBuffer)).toEqual(bytes);
  fetcher.mockResolvedValueOnce(json({ backup: { ...entry, size: 53 } }));
  await expect(createStorageConnector(config).uploadBackup(bytes)).rejects.toMatchObject({
    code: 'invalid-data',
  });
});
it('validates bounded lists and unique provider identities', async () => {
  fetcher.mockResolvedValueOnce(json({ backups: [entry] }));
  expect(await createStorageConnector(config).listBackups()).toEqual([entry]);
  fetcher.mockResolvedValueOnce(json({ backups: [entry, entry] }));
  await expect(createStorageConnector(config).listBackups()).rejects.toMatchObject({
    code: 'invalid-data',
  });
});
it.each([
  { id: 'https://evil.invalid/token' },
  { id: '../escape' },
  { name: 'file.txt' },
  { size: 0 },
  { size: -1 },
  { size: 53.5 },
])('rejects malformed entry before a download: %j', async (patch) => {
  await expect(
    createStorageConnector(config).downloadBackup({ ...entry, ...patch }),
  ).rejects.toMatchObject({ code: 'invalid-data' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects large uploads before transmission and rejects mismatched downloads', async () => {
  await expect(
    createStorageConnector(config).uploadBackup(new Uint8Array(CONNECTOR_TRANSPORT_MAX_BYTES + 1)),
  ).rejects.toMatchObject({ code: 'too-large' });
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array(51)));
  await expect(createStorageConnector(config).downloadBackup(entry)).rejects.toMatchObject({
    code: 'invalid-data',
  });
});
it('downloads by validated Google file ID and matches encrypted byte length', async () => {
  const bytes = new Uint8Array(52).fill(7);
  fetcher.mockResolvedValue(new Response(bytes));
  expect(await createStorageConnector(config).downloadBackup(entry)).toEqual(bytes);
  expect(fetcher.mock.calls[0][0]).toBe(
    '/api/google-drive?action=download&id=synthetic_file_123&size=52',
  );
});
it.each(['auth', 'permission', 'quota', 'unavailable', 'network'])(
  'shows only sanitized %s error codes',
  async (code) => {
    fetcher.mockResolvedValue(
      json({ error: { code, message: 'synthetic-secret-do-not-expose' } }, 401),
    );
    await expect(connectorRequest('google-drive', 'session')).rejects.toMatchObject({
      code,
      message: code,
    });
  },
);
it('logs out with a cookie-scoped POST rather than deleting backups', async () => {
  fetcher.mockResolvedValue(json({}));
  await logoutGoogleDrive();
  expect(fetcher.mock.calls[0][0]).toBe('/api/google-drive?action=logout');
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    headers: expect.objectContaining({ 'X-Roamlet-Request': '1' }),
  });
});
it('preserves cancellation and bounds a stalled response stream', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    connectorRequest('google-drive', 'session', {}, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
  vi.useFakeTimers();
  const cancelled = vi.fn();
  fetcher.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled })));
  const pending = connectorRequest('google-drive', 'download');
  const asserted = expect(pending).rejects.toMatchObject({ code: 'timeout' });
  await vi.advanceTimersByTimeAsync(65_000);
  await asserted;
  expect(cancelled).toHaveBeenCalled();
});
