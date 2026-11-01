import { BACKUP_LIMITS, parseBackup, type RouteBackup } from './backup';

export const ENCRYPTED_BACKUP_MAX_BYTES = 30 * 1024 * 1024;

// ROAMLET + binary version 1; no attacker-controlled KDF parameters.
const HEADER = new Uint8Array([82, 79, 65, 77, 76, 69, 84, 1]);
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PREFIX_BYTES = HEADER.length + SALT_BYTES + IV_BYTES;
const TAG_BYTES = 16;
const ITERATIONS = 310_000;

async function key(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts only the existing library JSON; connection credentials are not an input. */
export async function encryptBackup(text: string, password: string): Promise<Uint8Array> {
  try {
    if (typeof password !== 'string' || password.length < 12 || !password.trim()) throw new Error();
    if (typeof text !== 'string' || text.length > BACKUP_LIMITS.bytes) throw new Error();
    const plain = new TextEncoder().encode(text);
    if (
      plain.byteLength > BACKUP_LIMITS.bytes ||
      new TextDecoder('utf-8', { fatal: true }).decode(plain) !== text
    )
      throw new Error();
    parseBackup(text);
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const prefix = new Uint8Array(PREFIX_BYTES);
    prefix.set(HEADER);
    prefix.set(salt, HEADER.length);
    prefix.set(iv, HEADER.length + SALT_BYTES);
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: prefix, tagLength: 128 },
        await key(password, salt),
        plain,
      ),
    );
    const result = new Uint8Array(prefix.length + encrypted.length);
    result.set(prefix);
    result.set(encrypted, prefix.length);
    return result;
  } catch {
    throw new Error('Unable to encrypt backup.');
  }
}

/** Wrong passwords, unknown formats and corrupted documents share a sanitized error. */
export async function decryptBackup(bytes: Uint8Array, password: string): Promise<RouteBackup> {
  try {
    if (typeof password !== 'string' || !password.trim()) throw new Error();
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < PREFIX_BYTES + TAG_BYTES ||
      bytes.byteLength > ENCRYPTED_BACKUP_MAX_BYTES ||
      !HEADER.every((byte, index) => bytes[index] === byte)
    )
      throw new Error();
    const snapshot = new Uint8Array(bytes);
    const salt = snapshot.slice(HEADER.length, HEADER.length + SALT_BYTES);
    const iv = snapshot.slice(HEADER.length + SALT_BYTES, PREFIX_BYTES);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: snapshot.slice(0, PREFIX_BYTES),
          tagLength: 128,
        },
        await key(password, salt),
        snapshot.slice(PREFIX_BYTES),
      ),
    );
    if (plain.byteLength > BACKUP_LIMITS.bytes) throw new Error();
    return parseBackup(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    throw new Error('Unable to decrypt backup.');
  }
}
