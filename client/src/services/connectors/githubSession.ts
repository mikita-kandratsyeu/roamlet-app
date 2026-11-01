import { ConnectorError } from './types';
import { connectorRequest, connectorJson, CONNECTOR_TRANSPORT_MAX_BYTES } from './http';

export interface GitHubSession {
  available: boolean;
  connected: boolean;
  login?: string;
  installUrl?: string;
}
export interface GitHubRepository {
  owner: string;
  name: string;
}
export const GITHUB_TRANSPORT_MAX_BYTES = CONNECTOR_TRANSPORT_MAX_BYTES;
export function githubRequest(
  action: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
  body?: Uint8Array | null,
): Promise<Uint8Array> {
  return connectorRequest('github', action, params, signal, body);
}
export function githubJson(
  action: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
  body?: null,
): Promise<Record<string, unknown>> {
  return connectorJson('github', action, params, signal, body);
}
export async function getGitHubSession(signal?: AbortSignal): Promise<GitHubSession> {
  const data = await githubJson('session', {}, signal);
  if (
    typeof data.available !== 'boolean' ||
    typeof data.connected !== 'boolean' ||
    (data.login !== undefined && typeof data.login !== 'string')
  )
    throw new ConnectorError('invalid-data');
  let installUrl: string | undefined;
  if (typeof data.installUrl === 'string') {
    try {
      const url = new URL(data.installUrl);
      if (
        url.origin !== 'https://github.com' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/apps\/[a-z0-9-]+\/installations\/new$/.test(url.pathname)
      )
        throw new ConnectorError('invalid-data');
      installUrl = url.href;
    } catch {
      throw new ConnectorError('invalid-data');
    }
  }
  return {
    available: data.available,
    connected: data.connected,
    login: typeof data.login === 'string' ? data.login : undefined,
    installUrl,
  };
}
export async function getGitHubRepositories(signal?: AbortSignal): Promise<GitHubRepository[]> {
  const data = await githubJson('repositories', {}, signal);
  if (!Array.isArray(data.repositories) || data.repositories.length > 100)
    throw new ConnectorError('invalid-data');
  return data.repositories.map((item: unknown) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('owner' in item) ||
      typeof item.owner !== 'string' ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !/^[A-Za-z0-9-]{1,39}$/.test(item.owner) ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(item.name)
    )
      throw new ConnectorError('invalid-data');
    return { owner: item.owner, name: item.name };
  });
}
export async function logoutGitHub(signal?: AbortSignal): Promise<void> {
  await githubJson('logout', {}, signal, null);
}
