export const DISCLAIMER_KEY = 'roamlet:disclaimer:v1';

export function isDisclaimerAcknowledged(): boolean {
  try {
    return localStorage.getItem(DISCLAIMER_KEY) === 'acknowledged';
  } catch {
    return false;
  }
}

export function saveDisclaimerAcknowledgement(): boolean {
  try {
    localStorage.setItem(DISCLAIMER_KEY, 'acknowledged');
    return true;
  } catch {
    return false;
  }
}
