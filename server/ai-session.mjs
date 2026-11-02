import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { connection, object } from './ai-contract.mjs';

export const SESSION_SECONDS = 3600;
export const DEFAULT_PROVIDERS = ['https://api.openai.com/v1'];
function providerUrl(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\\%?#]/.test(value)) return false;
  const url = new URL(value);
  const host = url.hostname;
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    (url.href === value || url.origin === value) &&
    !isIP(host.replace(/^\[|\]$/g, '')) &&
    host.includes('.') &&
    !host.endsWith('.') &&
    !/(^|\.)(localhost|local|internal|lan|home|invalid)$/.test(host) &&
    host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}
export function aiConfig(env = process.env) {
  try {
    const secret = env.AI_SESSION_SECRET?.trim();
    const key = Buffer.from(secret ?? '', 'base64');
    if (key.length !== 32 || key.toString('base64') !== secret) return null;
    const origin = env.AI_ORIGIN?.trim();
    const url = new URL(origin);
    const local =
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (!local && url.protocol !== 'https:') ||
      url.origin !== origin ||
      url.username ||
      url.password
    )
      return null;
    const providers =
      env.AI_PROVIDER_URLS === undefined
        ? [...DEFAULT_PROVIDERS]
        : JSON.parse(env.AI_PROVIDER_URLS);
    if (
      !Array.isArray(providers) ||
      providers.length < 1 ||
      providers.length > 16 ||
      new Set(providers).size !== providers.length ||
      !providers.every(providerUrl)
    )
      return null;
    return { origin, key, secure: !local, providers };
  } catch {
    return null;
  }
}
export function cookieName(config) {
  return `${config.secure ? '__Host-' : ''}roamlet-ai-session`;
}
export function cookie(config, value, seconds) {
  return `${cookieName(config)}=${value}; Path=/; Max-Age=${Math.min(SESSION_SECONDS, Math.max(0, seconds))}; HttpOnly; SameSite=Lax${config.secure ? '; Secure' : ''}`;
}
function aad(config, purpose) {
  return Buffer.from(`${config.origin}:ai:${purpose}:1`);
}
export function seal(config, payload, purpose = 'session') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.key, iv);
  cipher.setAAD(aad(config, purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function openCookie(req, config, now = Date.now()) {
  try {
    const raw = req.headers?.cookie;
    if (typeof raw !== 'string' || raw.length > 16384) return null;
    const prefix = `${cookieName(config)}=`;
    const values = raw
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(prefix));
    if (values.length !== 1) return null;
    const value = values[0].slice(prefix.length);
    if (!/^[A-Za-z0-9_-]{40,3800}$/.test(value)) return null;
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return null;
    const decipher = createDecipheriv('aes-256-gcm', config.key, bytes.subarray(0, 12));
    decipher.setAAD(aad(config, 'session'));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
    );
    object(payload, ['baseUrl', 'model', 'apiKey', 'issuedAt', 'expiresAt']);
    connection(
      { baseUrl: payload.baseUrl, model: payload.model, apiKey: payload.apiKey },
      config.providers,
    );
    if (
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.issuedAt > now ||
      payload.expiresAt <= now ||
      payload.expiresAt <= payload.issuedAt ||
      payload.expiresAt - payload.issuedAt > SESSION_SECONDS * 1000
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}
