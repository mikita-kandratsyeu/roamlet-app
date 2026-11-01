import { abortable, GithubError, JSON_LIMIT, TRANSPORT_LIMIT } from './github-http.mjs';
import { validLogin } from './github-session.mjs';

const API = 'https://api.github.com';
export const FOLDER = 'roamlet-backups';
export const SNAPSHOT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.roamlet$/;

export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GithubError('invalid-data');
  return value;
}

export function repositoryName(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._-]{1,100}$/.test(value) &&
    !['.', '..'].includes(value)
  );
}

export function validateRepository(owner, repository) {
  if (!validLogin(owner) || !repositoryName(repository))
    throw new GithubError('configuration', 400);
}

export function fileEntry(value) {
  const file = object(value);
  if (
    file.type !== 'file' ||
    'target' in file ||
    'submodule_git_url' in file ||
    typeof file.name !== 'string' ||
    !SNAPSHOT.test(file.name) ||
    file.path !== `${FOLDER}/${file.name}` ||
    !Number.isSafeInteger(file.size) ||
    file.size < 52
  )
    throw new GithubError('invalid-data');
  if (file.size > TRANSPORT_LIMIT) throw new GithubError('too-large', 413);
  return { id: file.path, name: file.name, size: file.size };
}

function upstreamError(response) {
  if (response.status === 401) return new GithubError('auth', 401);
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('retry-after') ||
        response.headers.get('x-ratelimit-remaining') === '0'))
  )
    return new GithubError('quota', 429);
  if (response.status === 403) return new GithubError('permission', 403);
  if (response.status === 404) return new GithubError('not-found', 404);
  if ([409, 422].includes(response.status)) return new GithubError('conflict', 409);
  return new GithubError();
}

export function createGithubClient(fetcher = globalThis.fetch) {
  async function request(
    path,
    {
      token,
      signal,
      method = 'GET',
      body,
      raw = false,
      metadata = false,
      config,
      oauth = false,
      revoke = false,
    } = {},
  ) {
    const url = oauth ? 'https://github.com/login/oauth/access_token' : `${API}${path}`;
    let reader;
    try {
      if (signal.aborted) throw signal.reason;
      const response = await abortable(
        Promise.resolve().then(() =>
          fetcher(url, {
            method,
            signal,
            credentials: 'omit',
            redirect: 'error',
            headers: {
              Accept: raw
                ? 'application/vnd.github.raw+json'
                : metadata
                  ? 'application/vnd.github.object+json'
                  : 'application/json',
              ...(!oauth
                ? {
                    'X-GitHub-Api-Version': '2026-03-10',
                    Authorization: revoke
                      ? `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
                      : `Bearer ${token}`,
                  }
                : {}),
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        ),
        signal,
      );
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw upstreamError(response);
      }
      if (/\brel\s*=\s*"?next\b/i.test(response.headers.get('link') ?? '')) {
        void response.body?.cancel().catch(() => {});
        throw new GithubError('too-large', 413);
      }
      const limit = oauth ? 16 * 1024 : raw ? TRANSPORT_LIMIT : JSON_LIMIT;
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
        void response.body?.cancel().catch(() => {});
        throw new GithubError('too-large', 413);
      }
      const chunks = [];
      let count = 0;
      reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const { value, done } = await abortable(reader.read(), signal);
          if (done) break;
          count += value.byteLength;
          if (count > limit) throw new GithubError('too-large', 413);
          chunks.push(Buffer.from(value));
        }
      }
      const bytes = Buffer.concat(chunks);
      if (raw) return bytes;
      if (response.status === 204) return null;
      try {
        return JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new GithubError('invalid-data');
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof GithubError) throw error;
      throw new GithubError('network', 502);
    } finally {
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }

  function collection(payload, key) {
    object(payload);
    if (
      !Number.isSafeInteger(payload.total_count) ||
      payload.total_count < 0 ||
      !Array.isArray(payload[key])
    )
      throw new GithubError('invalid-data');
    if (payload.total_count > 100) throw new GithubError('too-large', 413);
    if (payload[key].length !== payload.total_count) throw new GithubError('too-large', 413);
    return payload[key];
  }

  async function repositories(config, token, signal) {
    const installs = collection(
      await request('/user/installations?per_page=100&page=1', { token, signal }),
      'installations',
    );
    const seen = new Set();
    const result = [];
    let total = 0;
    for (const item of installs) {
      const installation = object(item);
      if (
        !Number.isSafeInteger(installation.id) ||
        installation.id <= 0 ||
        seen.has(installation.id)
      )
        throw new GithubError('invalid-data');
      seen.add(installation.id);
      if (
        installation.app_slug !== config.slug ||
        (installation.client_id !== undefined && installation.client_id !== config.clientId) ||
        installation.suspended_at
      )
        continue;
      if (
        object(installation.permissions).contents !== 'write' ||
        !['read', 'write'].includes(installation.permissions.metadata)
      )
        continue;
      const repos = collection(
        await request(`/user/installations/${installation.id}/repositories?per_page=100&page=1`, {
          token,
          signal,
        }),
        'repositories',
      );
      total += repos.length;
      if (total > 100) throw new GithubError('too-large', 413);
      for (const value of repos) {
        const repo = object(value);
        if (
          !Number.isSafeInteger(repo.id) ||
          repo.id <= 0 ||
          !validLogin(object(repo.owner).login) ||
          !repositoryName(repo.name) ||
          typeof repo.private !== 'boolean'
        )
          throw new GithubError('invalid-data');
        if (repo.private && object(repo.permissions).push === true)
          result.push({ owner: repo.owner.login, name: repo.name, id: repo.id });
      }
    }
    const keys = new Set(result.map((repo) => repo.id));
    if (keys.size !== result.length) throw new GithubError('invalid-data');
    return result.sort((a, b) =>
      `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`, 'en'),
    );
  }

  async function verify(config, token, signal, owner, repository) {
    validateRepository(owner, repository);
    const accessible = await repositories(config, token, signal);
    const selected = accessible.find(
      (repo) =>
        repo.owner.toLowerCase() === owner.toLowerCase() &&
        repo.name.toLowerCase() === repository.toLowerCase(),
    );
    if (!selected) throw new GithubError('permission', 403);
    const path = `/repos/${owner}/${repository}`;
    const repo = object(await request(path, { token, signal }));
    if (repo.private !== true || object(repo.permissions).push !== true)
      throw new GithubError('permission', 403);
    if (
      repo.id !== selected.id ||
      !validLogin(object(repo.owner).login) ||
      !repositoryName(repo.name) ||
      repo.owner.login.toLowerCase() !== owner.toLowerCase() ||
      repo.name.toLowerCase() !== repository.toLowerCase()
    )
      throw new GithubError('invalid-data');
    return path;
  }

  async function directory(path, token, signal) {
    let entries;
    try {
      entries = await request(`${path}/contents/${FOLDER}`, { token, signal });
    } catch (error) {
      if (error instanceof GithubError && error.code === 'not-found') return [];
      throw error;
    }
    if (!Array.isArray(entries)) throw new GithubError('invalid-data');
    if (entries.length >= 1000) throw new GithubError('too-large', 413);
    const paths = new Set();
    for (const item of entries) {
      object(item);
      if (
        typeof item.name !== 'string' ||
        typeof item.path !== 'string' ||
        !item.name ||
        item.name.includes('/') ||
        item.path !== `${FOLDER}/${item.name}` ||
        paths.has(item.path)
      )
        throw new GithubError('invalid-data');
      paths.add(item.path);
    }
    return entries;
  }

  return { request, repositories, verify, directory };
}
