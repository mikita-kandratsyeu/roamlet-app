import { expect, it } from 'vitest';
import { backupPasswordStrength, generateBackupPassword } from './backupPassword';

it('reports an approximate score without treating length alone or repetition as strong', () => {
  expect(backupPasswordStrength('short')).toBe('weak');
  expect(backupPasswordStrength('aaaaaaaaaaaaaaaaaaaaaaaa')).toBe('weak');
  expect(backupPasswordStrength('abcdabcdabcdabcdabcdabcd')).toBe('weak');
  expect(backupPasswordStrength('a-long-memorable-passphrase')).toBe('fair');
  expect(backupPasswordStrength('very-long-Unique-Backup!42')).toBe('strong');
});

it('generates distinct 24-character passwords with each character class', () => {
  const passwords = Array.from({ length: 20 }, generateBackupPassword);
  expect(new Set(passwords).size).toBe(passwords.length);
  for (const password of passwords) {
    expect(password).toHaveLength(24);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^a-zA-Z0-9]/);
    expect(backupPasswordStrength(password)).toBe('strong');
  }
});
