export type PasswordStrength = 'weak' | 'fair' | 'strong';

export function backupPasswordStrength(password: string): PasswordStrength {
  const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((group) =>
    group.test(password),
  ).length;
  const unique = new Set(password).size;
  if (
    password.length < 12 ||
    unique < 6 ||
    /(.)\1{3,}/u.test(password) ||
    /^(.{1,4})\1+$/u.test(password)
  )
    return 'weak';
  if (password.length >= 20 && groups >= 3 && unique >= 12) return 'strong';
  return 'fair';
}

const characterGroups = [
  'abcdefghijkmnopqrstuvwxyz',
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%*-_?',
];
const alphabet = characterGroups.join('');

function randomIndex(size: number): number {
  const limit = Math.floor(256 / size) * size;
  const bytes = new Uint8Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= limit);
  return bytes[0] % size;
}

export function generateBackupPassword(): string {
  const characters = characterGroups.map((group) => group[randomIndex(group.length)]);
  for (let i = characters.length; i < 24; i++) {
    characters.push(alphabet[randomIndex(alphabet.length)]);
  }
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join('');
}
