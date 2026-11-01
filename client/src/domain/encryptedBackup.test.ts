import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_LIMITS, exportBackup } from './backup';
import { decryptBackup, encryptBackup, ENCRYPTED_BACKUP_MAX_BYTES } from './encryptedBackup';
import type { PlannedRoute } from './types';

const cryptoModule = 'node:crypto';
const { webcrypto } = (await import(/* @vite-ignore */ cryptoModule)) as { webcrypto: Crypto };
const password = 'synthetic-password-123';
const route: PlannedRoute = {
  id: 'route',
  name: 'Лес 🚲',
  description: 'Notes',
  activity: 'hiking',
  source: 'gpx',
  favorite: true,
  tags: ['forest'],
  segments: [
    [
      [1, 2, 5],
      [2, 3, 9],
    ],
    [[9, 8]],
  ],
  waypoints: [{ id: 'start', name: 'Start', coordinate: [1, 2, 5] }],
  stats: { distance: 1000, duration: 720, ascent: 4 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
const text = exportBackup([route]);
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function sealUnchecked(plain: Uint8Array, pass = password): Promise<Uint8Array> {
  const salt = new Uint8Array(16).fill(1);
  const iv = new Uint8Array(12).fill(2);
  const prefix = new Uint8Array(36);
  prefix.set([82, 79, 65, 77, 76, 69, 84, 1]);
  prefix.set(salt, 8);
  prefix.set(iv, 24);
  const material = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pass),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const encrypted = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: prefix, tagLength: 128 },
      key,
      new Uint8Array(plain),
    ),
  );
  const result = new Uint8Array(prefix.length + encrypted.length);
  result.set(prefix);
  result.set(encrypted, prefix.length);
  return result;
}

describe('encrypted library backups', () => {
  it('round-trips Unicode and full route snapshots without geometry/statistics changes', async () => {
    const bytes = await encryptBackup(text, password);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(new TextEncoder().encode(text).length + 52);
    expect(await decryptBackup(bytes, password)).toEqual(JSON.parse(text));
    expect(new TextDecoder().decode(bytes)).not.toContain(route.name);
    expect(new TextDecoder().decode(bytes)).not.toContain(password);
  });

  it('uses a fixed version header and fresh 16-byte salt/12-byte IV for each encryption', async () => {
    const first = await encryptBackup(text, password);
    const second = await encryptBackup(text, password);
    expect(first.slice(0, 8)).toEqual(new Uint8Array([82, 79, 65, 77, 76, 69, 84, 1]));
    expect(first.slice(8, 24)).not.toEqual(second.slice(8, 24));
    expect(first.slice(24, 36)).not.toEqual(second.slice(24, 36));
    expect(first).not.toEqual(second);
  });

  it.each(['', 'short', '            '])(
    'rejects invalid encryption passwords without leaking input',
    async (pass) => {
      await expect(encryptBackup(text, pass)).rejects.toThrow('Unable to encrypt backup.');
    },
  );

  it('rejects empty decrypt passwords and wrong passwords with the same sanitized error', async () => {
    const bytes = await encryptBackup(text, password);
    for (const pass of ['', 'wrong-password-123'])
      await expect(decryptBackup(bytes, pass)).rejects.toThrow('Unable to decrypt backup.');
  });

  it.each([0, 7, 8, 24, 36, -1])(
    'rejects corruption in magic/version/salt/IV/ciphertext/tag at %s',
    async (position) => {
      const bytes = await encryptBackup(text, password);
      bytes[position < 0 ? bytes.length - 1 : position] ^= 1;
      await expect(decryptBackup(bytes, password)).rejects.toThrow('Unable to decrypt backup.');
    },
  );

  it('rejects unknown/truncated/oversized formats before running the KDF', async () => {
    const derive = vi.spyOn(webcrypto.subtle, 'deriveKey');
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array(51),
      new Uint8Array(ENCRYPTED_BACKUP_MAX_BYTES + 1),
      new TextEncoder().encode(text),
    ])
      await expect(decryptBackup(bytes, password)).rejects.toThrow('Unable to decrypt backup.');
    expect(derive).not.toHaveBeenCalled();
  });

  it('validates JSON and existing route bounds before encryption', async () => {
    const derive = vi.spyOn(webcrypto.subtle, 'deriveKey');
    for (const invalid of [
      '{',
      JSON.stringify({ version: 2, routes: [] }),
      exportBackup([]).replace('"routes": []', '"routes": [{}]'),
      ' '.repeat(BACKUP_LIMITS.bytes + 1),
      JSON.stringify({
        version: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        routes: Array.from({ length: 1001 }, () => route),
      }),
    ])
      await expect(encryptBackup(invalid, password)).rejects.toThrow('Unable to encrypt backup.');
    expect(derive).not.toHaveBeenCalled();
  });

  it('bounds UTF-8 bytes, not only JavaScript character count, and rejects unpaired surrogates', async () => {
    await expect(encryptBackup('я'.repeat(BACKUP_LIMITS.bytes / 2 + 1), password)).rejects.toThrow(
      'Unable to encrypt backup.',
    );
    await expect(encryptBackup(text.replace('Notes', '\ud800'), password)).rejects.toThrow(
      'Unable to encrypt backup.',
    );
  });

  it('validates authenticated plaintext JSON/domain data and strict UTF-8 after decryption', async () => {
    for (const plain of [
      new Uint8Array([255]),
      new TextEncoder().encode('{'),
      new TextEncoder().encode(JSON.stringify({ version: 2 })),
      new TextEncoder().encode(text.replace('"distance": 1000', '"distance": -1')),
    ]) {
      const bytes = await sealUnchecked(plain);
      await expect(decryptBackup(bytes, password)).rejects.toThrow('Unable to decrypt backup.');
    }
  });

  it('enforces the 20 MiB plaintext limit after authenticated decryption', async () => {
    const bytes = await sealUnchecked(new Uint8Array(BACKUP_LIMITS.bytes + 1).fill(32));
    expect(bytes.length).toBeLessThan(ENCRYPTED_BACKUP_MAX_BYTES);
    await expect(decryptBackup(bytes, password)).rejects.toThrow('Unable to decrypt backup.');
  });

  it('accepts exactly the plaintext byte bound', async () => {
    const small = exportBackup([]);
    const padded = small + ' '.repeat(BACKUP_LIMITS.bytes - new TextEncoder().encode(small).length);
    const bytes = await encryptBackup(padded, password);
    expect(await decryptBackup(bytes, password)).toEqual(JSON.parse(small));
  });

  it('allows a nonempty legacy decrypt password without applying the new encryption policy', async () => {
    const bytes = await sealUnchecked(new TextEncoder().encode(text), 'short');
    expect(await decryptBackup(bytes, 'short')).toEqual(JSON.parse(text));
  });

  it('sanitizes Web Crypto failures without a raw cause', async () => {
    vi.spyOn(webcrypto.subtle, 'importKey').mockRejectedValue(new Error(password));
    await expect(encryptBackup(text, password)).rejects.toMatchObject({
      message: 'Unable to encrypt backup.',
    });
  });
});
