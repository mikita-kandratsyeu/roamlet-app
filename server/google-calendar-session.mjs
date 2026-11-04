import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { validIdentity } from './google-drive-session.mjs';
export { equalState } from './github-session.mjs';

export const SESSION_SECONDS = 3600;
export const STATE_SECONDS = 600;
export const TARGET_SECONDS = 365 * 24 * 3600;
export const GOOGLE_CALENDAR_ENV_NAMES = [
  'GOOGLE_CALENDAR_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'GOOGLE_CALENDAR_CALLBACK_URL',
  'GOOGLE_CALENDAR_SESSION_SECRET',
];
export function googleCalendarConfig(env = process.env) {
  try {
    const values = GOOGLE_CALENDAR_ENV_NAMES.map((name) => env[name]?.trim());
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
      url.pathname !== '/api/google-calendar' ||
      url.search !== '?action=callback'
    )
      return null;
    const key = Buffer.from(secret, 'base64');
    if (key.length !== 32 || key.toString('base64') !== secret) return null;
    return { clientId, clientSecret, callback, origin: url.origin, key, secure: !local };
  } catch {
    return null;
  }
}
export function validCalendarId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.@-]{1,512}$/.test(value);
}
export function cookieName(config, purpose) {
  return `${config.secure ? '__Host-' : ''}roamlet-google-calendar-${purpose}`;
}
export function cookie(config, purpose, value, seconds) {
  return `${cookieName(config, purpose)}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax${config.secure ? '; Secure' : ''}`;
}
function aad(config, purpose) {
  return Buffer.from(`${config.origin}:${config.clientId}:google-calendar:${purpose}:1`);
}
export function seal(config, purpose, payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.key, iv);
  cipher.setAAD(aad(config, purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function exact(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function openCookie(req, config, purpose, now = Date.now()) {
  try {
    const raw = req.headers?.cookie;
    if (typeof raw !== 'string' || raw.length > 16384) return null;
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
    const max = { state: STATE_SECONDS, session: SESSION_SECONDS, target: TARGET_SECONDS }[purpose];
    if (
      !max ||
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.issuedAt > now ||
      payload.expiresAt <= now ||
      payload.expiresAt <= payload.issuedAt ||
      payload.expiresAt - payload.issuedAt > max * 1000
    )
      return null;
    const times = ['issuedAt', 'expiresAt'];
    if (purpose === 'state') {
      if (
        !exact(payload, [...times, 'state', 'verifier']) ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.state) ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.verifier)
      )
        return null;
    } else if (purpose === 'session') {
      if (
        !exact(payload, [...times, 'token', 'accountId', 'email']) ||
        typeof payload.token !== 'string' ||
        !/^[\x21-\x7e]{1,1024}$/.test(payload.token) ||
        !validIdentity({ sub: payload.accountId, email: payload.email, email_verified: true })
      )
        return null;
    } else if (
      !exact(payload, [...times, 'calendarId', 'accountId']) ||
      !validCalendarId(payload.calendarId) ||
      typeof payload.accountId !== 'string' ||
      !/^[\x21-\x7e]{1,255}$/.test(payload.accountId)
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}
