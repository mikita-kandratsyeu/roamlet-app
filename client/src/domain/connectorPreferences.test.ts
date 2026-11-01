import { beforeEach, expect, it } from 'vitest';
import {
  GITHUB_REPOSITORY_KEY,
  loadGitHubRepository,
  saveGitHubRepository,
} from './connectorPreferences';
beforeEach(() => localStorage.removeItem(GITHUB_REPOSITORY_KEY));
it('stores only repository metadata and reloads it without authentication data', () => {
  saveGitHubRepository({ provider: 'github', owner: 'example', repository: 'backups' });
  expect(JSON.parse(localStorage.getItem(GITHUB_REPOSITORY_KEY)!)).toEqual({
    owner: 'example',
    repository: 'backups',
  });
  expect(loadGitHubRepository()).toEqual({
    provider: 'github',
    owner: 'example',
    repository: 'backups',
  });
  saveGitHubRepository(null);
  expect(loadGitHubRepository()).toBeNull();
});
it.each([
  'not-json',
  '{"owner":"../escape","repository":"safe"}',
  '{"owner":"example","repository":"../escape"}',
  '{"owner":"example","repository":".."}',
])('ignores invalid persisted settings: %s', (value) => {
  localStorage.setItem(GITHUB_REPOSITORY_KEY, value);
  expect(loadGitHubRepository()).toBeNull();
});
