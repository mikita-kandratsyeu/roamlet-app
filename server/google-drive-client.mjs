import { randomBytes, randomUUID } from 'node:crypto';
import {
  abortable,
  checkCiphertext,
  GithubError as ConnectorError,
  TRANSPORT_LIMIT,
} from './github-http.mjs';
import { SNAPSHOT } from './github-client.mjs';
import { validIdentity } from './google-drive-session.mjs';
export { ConnectorError };

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const SCOPES = `openid email ${DRIVE_SCOPE}`;
const API = 'https://www.googleapis.com/drive/v3/files';
const FIELDS = 'id,name,size,parents,appProperties,mimeType';
const QUERY = "trashed = false and appProperties has { key='roamlet' and value='backup-v1' }";
const MIME = 'application/octet-stream';
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConnectorError('invalid-data');
  return value;
}
export function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);
}
export function fileSize(size, status = 502) {
  if (typeof size !== 'string' || !/^[1-9][0-9]{0,15}$/.test(size))
    throw new ConnectorError('invalid-data', status);
  const number = Number(size);
  if (number > TRANSPORT_LIMIT) throw new ConnectorError('too-large', 413);
  if (number < 52) throw new ConnectorError('invalid-data', status);
  return number;
}
export function fileEntry(value) {
  const file = object(value);
  if (
    !validId(file.id) ||
    typeof file.name !== 'string' ||
    !SNAPSHOT.test(file.name) ||
    !Array.isArray(file.parents) ||
    !file.parents.includes('appDataFolder') ||
    file.parents.some((parent) => typeof parent !== 'string') ||
    file.mimeType !== MIME ||
    object(file.appProperties).roamlet !== 'backup-v1' ||
    file.trashed === true
  )
    throw new ConnectorError('invalid-data');
  return { id: file.id, name: file.name, size: fileSize(file.size) };
}
function upstreamError(status) {
  if (status === 401) return new ConnectorError('auth', 401);
  if (status === 403) return new ConnectorError('permission', 403);
  if (status === 404) return new ConnectorError('not-found', 404);
  if (status === 429) return new ConnectorError('quota', 429);
  if ([409, 412].includes(status)) return new ConnectorError('conflict', 409);
  return new ConnectorError('unavailable', 502);
}

export function createGoogleDriveClient(fetcher = globalThis.fetch) {
  async function request(
    url,
    { signal, token, method = 'GET', body, contentType, raw = false, limit = 256 * 1024 } = {},
  ) {
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
              Accept: raw ? MIME : 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(contentType ? { 'Content-Type': contentType } : {}),
            },
            ...(body === undefined ? {} : { body }),
          }),
        ),
        signal,
      );
      const cancel = () => {
        void response.body?.cancel().catch(() => {});
      };
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
        cancel();
        throw new ConnectorError('too-large', 413);
      }
      // Read failures too, bounded and without exposing provider descriptions; quota reasons use HTTP 403.
      const chunks = [];
      let count = 0;
      reader = response.body?.getReader();
      if (reader)
        for (;;) {
          const { value, done } = await abortable(reader.read(), signal);
          if (done) break;
          count += value.byteLength;
          if (count > limit) throw new ConnectorError('too-large', 413);
          chunks.push(Buffer.from(value));
        }
      const bytes = Buffer.concat(chunks);
      if (!response.ok) {
        let payload;
        try {
          payload = JSON.parse(bytes.toString('utf8'));
        } catch {
          /* Never reflect upstream bodies. */
        }
        if (
          response.status === 403 &&
          Array.isArray(payload?.error?.errors) &&
          payload.error.errors.some((item) =>
            [
              'rateLimitExceeded',
              'userRateLimitExceeded',
              'dailyLimitExceeded',
              'storageQuotaExceeded',
            ].includes(item?.reason),
          )
        )
          throw new ConnectorError('quota', 429);
        if (url === 'https://oauth2.googleapis.com/token' && response.status === 400)
          throw new ConnectorError('auth', 401);
        throw upstreamError(response.status);
      }
      if (length !== null && Number(length) !== bytes.length)
        throw new ConnectorError('invalid-data');
      if (raw) return bytes;
      if (bytes.length === 0 && url === 'https://oauth2.googleapis.com/revoke') return null;
      try {
        return JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new ConnectorError('invalid-data');
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError('network', 502);
    } finally {
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }
  async function identity(token, signal) {
    const user = object(
      await request('https://openidconnect.googleapis.com/v1/userinfo', {
        token,
        signal,
        limit: 16 * 1024,
      }),
    );
    if (!validIdentity(user)) throw new ConnectorError('auth', 401);
    return { accountId: user.sub, email: user.email };
  }
  async function probe(token, signal) {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      pageSize: '1',
      fields: 'files(id)',
      q: QUERY,
    });
    const payload = object(await request(`${API}?${params}`, { token, signal, limit: 16 * 1024 }));
    if (
      !Array.isArray(payload.files) ||
      payload.files.length > 1 ||
      payload.files.some((file) => !validId(file?.id))
    )
      throw new ConnectorError('invalid-data');
  }
  async function list(token, signal) {
    const backups = [];
    const ids = new Set();
    const tokens = new Set();
    let pageToken;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: QUERY,
        fields: `files(${FIELDS}),nextPageToken`,
        pageSize: '100',
        orderBy: 'createdTime desc',
        ...(pageToken ? { pageToken } : {}),
      });
      const payload = object(await request(`${API}?${params}`, { token, signal }));
      if (!Array.isArray(payload.files)) throw new ConnectorError('invalid-data');
      if (payload.files.length > 100 || backups.length + payload.files.length > 1000)
        throw new ConnectorError('too-large', 413);
      for (const file of payload.files) {
        const entry = fileEntry(file);
        if (ids.has(entry.id)) throw new ConnectorError('invalid-data');
        ids.add(entry.id);
        backups.push(entry);
      }
      if (payload.nextPageToken === undefined) return backups;
      pageToken = payload.nextPageToken;
      if (
        typeof pageToken !== 'string' ||
        !/^[A-Za-z0-9_=-]{1,1024}$/.test(pageToken) ||
        tokens.has(pageToken)
      )
        throw new ConnectorError('invalid-data');
      tokens.add(pageToken);
    }
    throw new ConnectorError('too-large', 413);
  }
  async function upload(bytes, token, signal) {
    const name = `${randomUUID()}.roamlet`;
    const boundary = `roamlet_${randomBytes(24).toString('hex')}`;
    const metadata = {
      name,
      parents: ['appDataFolder'],
      mimeType: MIME,
      appProperties: { roamlet: 'backup-v1' },
    };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const params = new URLSearchParams({ uploadType: 'multipart', fields: FIELDS });
    const result = fileEntry(
      await request(`https://www.googleapis.com/upload/drive/v3/files?${params}`, {
        token,
        signal,
        method: 'POST',
        body,
        contentType: `multipart/related; boundary=${boundary}`,
        limit: 16 * 1024,
      }),
    );
    if (result.name !== name || result.size !== bytes.length)
      throw new ConnectorError('invalid-data');
    return result;
  }
  async function download(id, size, token, signal) {
    if (!validId(id)) throw new ConnectorError('invalid-data', 400);
    fileSize(String(size), 400);
    const metadata = fileEntry(
      await request(`${API}/${id}?${new URLSearchParams({ fields: FIELDS })}`, {
        token,
        signal,
        limit: 16 * 1024,
      }),
    );
    if (metadata.id !== id || metadata.size !== size) throw new ConnectorError('invalid-data');
    const bytes = await request(`${API}/${id}?alt=media`, {
      token,
      signal,
      raw: true,
      limit: size,
    });
    if (bytes.length !== size) throw new ConnectorError('invalid-data');
    try {
      checkCiphertext(bytes);
    } catch (error) {
      throw new ConnectorError(error.code, error.code === 'too-large' ? 413 : 502);
    }
    return bytes;
  }
  return {
    identity,
    probe,
    list,
    upload,
    download,
    exchange: (config, code, verifier, signal) =>
      request('https://oauth2.googleapis.com/token', {
        signal,
        method: 'POST',
        contentType: 'application/x-www-form-urlencoded',
        limit: 16 * 1024,
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.callback,
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
        }).toString(),
      }),
    revoke: (token, signal) =>
      request('https://oauth2.googleapis.com/revoke', {
        signal,
        method: 'POST',
        contentType: 'application/x-www-form-urlencoded',
        limit: 16 * 1024,
        body: new URLSearchParams({ token }).toString(),
      }),
  };
}
