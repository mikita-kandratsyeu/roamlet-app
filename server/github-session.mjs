import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_SECONDS = 8 * 60 * 60;
export const STATE_SECONDS = 10 * 60;
export const GITHUB_ENV_NAMES = [
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_CALLBACK_URL',
  'GITHUB_SESSION_SECRET',
];

export function githubConfig(env = process.env) {
  try {
    const values = GITHUB_ENV_NAMES.map((name) => env[name]?.trim());
    if (values.some((value) => !value)) return null;
    const [clientId, clientSecret, slug, callback, secret] = values;
    if (
      !/^[A-Za-z0-9._-]{1,100}$/.test(clientId) ||
      !/^[\x21-\x7e]{1,1024}$/.test(clientSecret) ||
      !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)
    )
      return null;
    const url = new URL(callback);
    const local =
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (!local && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== '/api/github' ||
      url.search !== '?action=callback'
    )
      return null;
    const key = Buffer.from(secret, 'base64');
    if (key.length !== 32 || key.toString('base64') !== secret) return null;
    return {
      clientId,
      clientSecret,
      slug,
      callback: url.href,
      origin: url.origin,
      key,
      secure: !local,
    };
  } catch {
    return null;
  }
}

export function cookieName(config, purpose) {
  return `${config.secure ? '__Host-' : ''}roamlet-github-${purpose}`;
}

export function cookie(config, purpose, value, seconds) {
  return `${cookieName(config, purpose)}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax${config.secure ? '; Secure' : ''}`;
}

export function seal(config, purpose, payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.key, iv);
  cipher.setAAD(Buffer.from(`${config.origin}:${config.clientId}:${purpose}:1`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function openCookie(req, config, purpose, now = Date.now()) {
  try {
    const raw = req.headers?.cookie;
    if (typeof raw !== 'string' || raw.length > 16_384) return null;
    const prefix = `${cookieName(config, purpose)}=`;
    const values = raw
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(prefix));
    if (values.length !== 1) return null;
    const value = values[0].slice(prefix.length);
    if (!/^[A-Za-z0-9_-]{40,3000}$/.test(value)) return null;
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return null;
    const decipher = createDecipheriv('aes-256-gcm', config.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${config.origin}:${config.clientId}:${purpose}:1`));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
    );
    const maxSeconds = purpose === 'state' ? STATE_SECONDS : SESSION_SECONDS;
    if (
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.issuedAt > now ||
      payload.expiresAt <= now ||
      payload.expiresAt <= payload.issuedAt ||
      payload.expiresAt - payload.issuedAt > maxSeconds * 1000
    )
      return null;
    if (purpose === 'state') {
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(payload.state) ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.verifier)
      )
        return null;
    } else if (
      typeof payload.token !== 'string' ||
      !/^[\x21-\x7e]{1,1024}$/.test(payload.token) ||
      !validLogin(payload.login) ||
      !Number.isSafeInteger(payload.userId) ||
      payload.userId <= 0
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

export function validLogin(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value) &&
    !value.includes('--')
  );
}

export function equalState(left, right) {
  return (
    typeof right === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}
