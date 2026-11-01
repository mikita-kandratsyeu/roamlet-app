import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export { equalState } from './github-session.mjs';

export const SESSION_SECONDS = 3600;
export const STATE_SECONDS = 600;
export const GOOGLE_DRIVE_ENV_NAMES = [
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_CALLBACK_URL',
  'GOOGLE_DRIVE_SESSION_SECRET',
];

export function googleDriveConfig(env = process.env) {
  try {
    const values = GOOGLE_DRIVE_ENV_NAMES.map((name) => env[name]?.trim());
    if (values.some((value) => !value)) return null;
    const [clientId, clientSecret, callback, secret] = values;
    if (!/^[A-Za-z0-9._-]{1,255}$/.test(clientId) || !/^[\x21-\x7e]{1,1024}$/.test(clientSecret))
      return null;
    const url = new URL(callback);
    const local =
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (!local && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      callback.includes('#') ||
      url.href !== callback ||
      url.pathname !== '/api/google-drive' ||
      url.search !== '?action=callback'
    )
      return null;
    const key = Buffer.from(secret, 'base64');
    if (key.length !== 32 || key.toString('base64') !== secret) return null;
    return { clientId, clientSecret, callback: url.href, origin: url.origin, key, secure: !local };
  } catch {
    return null;
  }
}

export function cookieName(config, purpose) {
  return `${config.secure ? '__Host-' : ''}roamlet-google-drive-${purpose}`;
}
export function cookie(config, purpose, value, seconds) {
  return `${cookieName(config, purpose)}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax${config.secure ? '; Secure' : ''}`;
}
function aad(config, purpose) {
  return Buffer.from(`${config.origin}:${config.clientId}:google-drive:${purpose}:1`);
}
export function seal(config, purpose, payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.key, iv);
  cipher.setAAD(aad(config, purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function validIdentity(user) {
  return (
    user &&
    typeof user.sub === 'string' &&
    /^[\x21-\x7e]{1,255}$/.test(user.sub) &&
    typeof user.email === 'string' &&
    Buffer.byteLength(user.email, 'utf8') <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email) &&
    [...user.email].every(
      (character) => character.codePointAt(0) >= 33 && character.codePointAt(0) !== 127,
    ) &&
    user.email_verified === true
  );
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
    decipher.setAAD(aad(config, purpose));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
    );
    const max = purpose === 'state' ? STATE_SECONDS : SESSION_SECONDS;
    if (
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.issuedAt > now ||
      payload.expiresAt <= now ||
      payload.expiresAt <= payload.issuedAt ||
      payload.expiresAt - payload.issuedAt > max * 1000
    )
      return null;
    if (purpose === 'state') {
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(payload.state) ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.verifier)
      )
        return null;
    } else if (
      purpose !== 'session' ||
      typeof payload.token !== 'string' ||
      !/^[\x21-\x7e]{1,1024}$/.test(payload.token) ||
      !validIdentity({ sub: payload.accountId, email: payload.email, email_verified: true })
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}
