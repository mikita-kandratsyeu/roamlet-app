import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DISCLAIMER_KEY,
  isDisclaimerAcknowledged,
  saveDisclaimerAcknowledgement,
} from './disclaimer';
import { resetPreferences } from './preferences';

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('only accepts the separate acknowledgement marker and survives resetting preferences', () => {
  expect(isDisclaimerAcknowledged()).toBe(false);
  localStorage.setItem(DISCLAIMER_KEY, 'invalid');
  expect(isDisclaimerAcknowledged()).toBe(false);
  expect(saveDisclaimerAcknowledgement()).toBe(true);
  expect(isDisclaimerAcknowledged()).toBe(true);
  expect(resetPreferences()).toBe(true);
  expect(isDisclaimerAcknowledged()).toBe(true);
  localStorage.clear();
  expect(isDisclaimerAcknowledged()).toBe(false);
});

it('handles denied storage access without throwing', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  expect(isDisclaimerAcknowledged()).toBe(false);
  expect(saveDisclaimerAcknowledgement()).toBe(false);
});
