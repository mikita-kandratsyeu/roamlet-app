import type { GitHubStorageConnection } from '../services/connectors/types';
export const GITHUB_REPOSITORY_KEY = 'roamlet-github-repository';
export function loadGitHubRepository(): GitHubStorageConnection | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(GITHUB_REPOSITORY_KEY) || 'null');
    if (
      !value ||
      typeof value !== 'object' ||
      !('owner' in value) ||
      typeof value.owner !== 'string' ||
      !('repository' in value) ||
      typeof value.repository !== 'string' ||
      !/^[A-Za-z0-9-]{1,39}$/.test(value.owner) ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(value.repository) ||
      ['.', '..'].includes(value.repository)
    )
      return null;
    return { provider: 'github', owner: value.owner, repository: value.repository };
  } catch {
    return null;
  }
}
export function saveGitHubRepository(connection: GitHubStorageConnection | null): void {
  try {
    if (connection)
      localStorage.setItem(
        GITHUB_REPOSITORY_KEY,
        JSON.stringify({ owner: connection.owner, repository: connection.repository }),
      );
    else localStorage.removeItem(GITHUB_REPOSITORY_KEY);
  } catch {
    /* The active connection remains usable if preferences cannot persist. */
  }
}
