import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GitHubStorageConnector } from './github';
import { createStorageConnector, STORAGE_PROVIDERS } from './registry';
import {
  getGitHubSession,
  getGitHubRepositories,
  logoutGitHub,
  githubRequest,
  GITHUB_TRANSPORT_MAX_BYTES,
} from './githubSession';
const config = { provider: 'github' as const, owner: 'example', repository: 'backups' };
const entry = {
  id: 'roamlet-backups/11111111-1111-4111-8111-111111111111.roamlet',
  name: '11111111-1111-4111-8111-111111111111.roamlet',
  size: 3,
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
it('registers GitHub metadata independently from the storage contract', () => {
  expect(createStorageConnector(config)).toBeInstanceOf(GitHubStorageConnector);
  expect(STORAGE_PROVIDERS[0]).toMatchObject({ id: 'github', icon: '/github-mark.png' });
});
it.each([
  { owner: '../escape' },
  { repository: '..' },
  { repository: 'x/repo' },
  { owner: 'a--b' },
])('rejects malformed repository settings: %j', (patch) => {
  expect(() => new GitHubStorageConnector({ ...config, ...patch })).toThrow('configuration');
  expect(fetcher).not.toHaveBeenCalled();
});
it('uses only same-origin cookie authentication and never adds an Authorization header', async () => {
  fetcher.mockResolvedValue(json({}));
  await createStorageConnector(config).checkConnection();
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('/api/github?action=check&owner=example&repository=backups');
  expect(options).toMatchObject({
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  expect(options?.headers).not.toHaveProperty('Authorization');
});
it('validates session and fixed GitHub App installation URL without exposing tokens', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      available: true,
      connected: true,
      login: 'example',
      installUrl: 'https://github.com/apps/roamlet/installations/new',
    }),
  );
  expect(await getGitHubSession()).toMatchObject({ connected: true, login: 'example' });
  fetcher.mockResolvedValueOnce(
    json({
      available: true,
      connected: true,
      installUrl: 'https://evil.invalid/apps/roamlet/installations/new',
    }),
  );
  await expect(getGitHubSession()).rejects.toMatchObject({ code: 'invalid-data' });
});
it('validates available repository selection', async () => {
  fetcher.mockResolvedValueOnce(json({ repositories: [{ owner: 'example', name: 'backups' }] }));
  expect(await getGitHubRepositories()).toEqual([{ owner: 'example', name: 'backups' }]);
  fetcher.mockResolvedValueOnce(json({ repositories: [{ owner: 'example', name: '../escape' }] }));
  await expect(getGitHubRepositories()).rejects.toMatchObject({ code: 'invalid-data' });
});
it('uploads ciphertext with CSRF marker and checks returned size', async () => {
  fetcher.mockResolvedValueOnce(json({ backup: entry }));
  expect(await createStorageConnector(config).uploadBackup(new Uint8Array([1, 2, 3]))).toEqual(
    entry,
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Roamlet-Request': '1' },
  });
  expect(new Uint8Array(fetcher.mock.calls[0][1]?.body as ArrayBuffer)).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  fetcher.mockResolvedValueOnce(json({ backup: { ...entry, size: 4 } }));
  await expect(
    createStorageConnector(config).uploadBackup(new Uint8Array([1, 2, 3])),
  ).rejects.toMatchObject({ code: 'invalid-data' });
});
it('rejects oversize uploads before fetch and malformed or mismatched downloads', async () => {
  await expect(
    createStorageConnector(config).uploadBackup(new Uint8Array(GITHUB_TRANSPORT_MAX_BYTES + 1)),
  ).rejects.toMatchObject({ code: 'too-large' });
  await expect(
    createStorageConnector(config).downloadBackup({ ...entry, id: '../escape' }),
  ).rejects.toMatchObject({ code: 'invalid-data' });
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response(new Uint8Array([1, 2])));
  await expect(createStorageConnector(config).downloadBackup(entry)).rejects.toMatchObject({
    code: 'invalid-data',
  });
});
it('validates bounded snapshot lists and duplicate identities', async () => {
  fetcher.mockResolvedValueOnce(json({ backups: [entry] }));
  expect(await createStorageConnector(config).listBackups()).toEqual([entry]);
  fetcher.mockResolvedValueOnce(json({ backups: [entry, entry] }));
  await expect(createStorageConnector(config).listBackups()).rejects.toMatchObject({
    code: 'invalid-data',
  });
});
it('bounds response bytes including dishonest content length', async () => {
  fetcher.mockResolvedValue(new Response(new Uint8Array(GITHUB_TRANSPORT_MAX_BYTES + 1)));
  await expect(githubRequest('download')).rejects.toMatchObject({ code: 'too-large' });
});
it.each(['auth', 'permission', 'unavailable', 'quota', 'too-large'])(
  'returns only sanitized %s errors',
  async (code) => {
    fetcher.mockResolvedValue(
      json({ error: { code, message: 'synthetic-secret-never-show' } }, 403),
    );
    await expect(githubRequest('check')).rejects.toMatchObject({ code, message: code });
  },
);
it('logout posts a same-origin CSRF-protected request', async () => {
  fetcher.mockResolvedValue(json({}));
  await logoutGitHub();
  expect(fetcher.mock.calls[0]).toEqual([
    '/api/github?action=logout',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-Roamlet-Request': '1' }),
    }),
  ]);
});
it('does not start an already cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(githubRequest('session', {}, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it('times out response-body consumption even when a stream stalls', async () => {
  vi.useFakeTimers();
  const cancelled = vi.fn();
  fetcher.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled })));
  const pending = githubRequest('session');
  const checked = expect(pending).rejects.toMatchObject({ code: 'timeout' });
  await vi.advanceTimersByTimeAsync(65_000);
  await checked;
  expect(cancelled).toHaveBeenCalled();
});
it('preserves explicit abort and bounds fetch timeout', async () => {
  vi.useFakeTimers();
  fetcher.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        ),
      ),
  );
  const controller = new AbortController();
  const pending = githubRequest('session', {}, controller.signal);
  const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await check;
  const timed = githubRequest('session');
  const timedCheck = expect(timed).rejects.toMatchObject({ code: 'timeout' });
  await vi.advanceTimersByTimeAsync(65_000);
  await timedCheck;
});
