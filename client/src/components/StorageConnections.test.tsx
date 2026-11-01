import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StorageConnections } from './StorageConnections';
import { createStorageConnector } from '../services/connectors/registry';
import {
  getGitHubSession,
  getGitHubRepositories,
  logoutGitHub,
} from '../services/connectors/githubSession';
import { ConnectorError, type StorageConnector } from '../services/connectors/types';
import { routeDb } from '../domain/storage';
import { GITHUB_REPOSITORY_KEY } from '../domain/connectorPreferences';
import i18n from '../i18n';
const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto');
vi.mock('../services/connectors/registry', async (original) => ({
  ...(await original<typeof import('../services/connectors/registry')>()),
  createStorageConnector: vi.fn(),
}));
vi.mock('../services/connectors/githubSession', () => ({
  getGitHubSession: vi.fn(),
  getGitHubRepositories: vi.fn(),
  logoutGitHub: vi.fn(),
}));
const entry = {
  id: 'roamlet-backups/11111111-1111-4111-8111-111111111111.roamlet',
  name: '11111111-1111-4111-8111-111111111111.roamlet',
  size: 100,
};
const authorized = {
  available: true,
  connected: true,
  login: 'example',
  installUrl: 'https://github.com/apps/roamlet/installations/new',
};
let storage: StorageConnector;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('BroadcastChannel', undefined);
  localStorage.removeItem(GITHUB_REPOSITORY_KEY);
  vi.mocked(createStorageConnector).mockReset();
  vi.mocked(getGitHubSession).mockReset();
  vi.mocked(getGitHubRepositories).mockReset();
  vi.mocked(logoutGitHub).mockReset();
  vi.mocked(getGitHubSession).mockResolvedValue({ ...authorized, connected: false });
  vi.mocked(getGitHubRepositories).mockResolvedValue([{ owner: 'example', name: 'backups' }]);
  vi.mocked(logoutGitHub).mockResolvedValue(undefined);
  storage = {
    checkConnection: vi.fn().mockResolvedValue(undefined),
    listBackups: vi.fn().mockResolvedValue([]),
    uploadBackup: vi.fn().mockResolvedValue(entry),
    downloadBackup: vi.fn(),
  };
  vi.mocked(createStorageConnector).mockReturnValue(storage);
  await routeDb.routes.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setupRepository() {
  const user = userEvent.setup();
  vi.mocked(getGitHubSession).mockResolvedValue(authorized);
  render(<StorageConnections open onClose={vi.fn()} />);
  await screen.findByText('Connected', { exact: true });
  await user.click(screen.getByRole('button', { name: 'Manage connection' }));
  await user.click(screen.getByRole('button', { name: 'Load accessible repositories' }));
  await user.selectOptions(screen.getByLabelText('Private repository'), 'example/backups');
  await user.click(screen.getByRole('button', { name: 'Use this repository' }));
  await screen.findByText('Connected to example/backups');
  return user;
}
it('renders a searchable card grid and opens setup as an accessible modal with restored focus', async () => {
  render(<StorageConnections open onClose={vi.fn()} />);
  await screen.findByText('Not connected');
  const card = within(screen.getByRole('list', { name: 'Available connectors' })).getByRole(
    'listitem',
  );
  expect(card.querySelector('img')).toHaveAttribute('src', '/github-mark.png');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const user = userEvent.setup();
  const setup = screen.getByRole('button', { name: 'Set up connection' });
  await user.click(setup);
  const modal = screen.getByRole('dialog', { name: 'GitHub connection settings' });
  expect(modal).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeEnabled();
  expect(modal.querySelector('input[type=password]')).toBeNull();
  expect(screen.getByRole('link', { name: 'Install or configure GitHub App' })).toHaveAttribute(
    'href',
    authorized.installUrl,
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(setup).toHaveFocus());
  await user.type(screen.getByRole('textbox', { name: 'Search connectors' }), 'drive');
  expect(screen.getByText('No connectors match this filter.')).toBeVisible();
  await user.clear(screen.getByRole('textbox', { name: 'Search connectors' }));
  await user.click(screen.getByRole('button', { name: 'Connected connectors' }));
  expect(screen.getByText('No connectors match this filter.')).toBeVisible();
});
it('disables authorization with missing server configuration without hiding local navigation', async () => {
  vi.mocked(getGitHubSession).mockResolvedValue({ available: false, connected: false });
  const close = vi.fn();
  render(<StorageConnections open onClose={close} />);
  await screen.findByText('Unavailable');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Set up connection' }));
  expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeDisabled();
  await userEvent.setup().keyboard('{Escape}');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Back to map' }));
  expect(close).toHaveBeenCalledOnce();
});
it('selects an app-authorized repository and persists only public connection metadata', async () => {
  await setupRepository();
  expect(createStorageConnector).toHaveBeenCalledWith({
    provider: 'github',
    owner: 'example',
    repository: 'backups',
  });
  expect(JSON.parse(localStorage.getItem(GITHUB_REPOSITORY_KEY)!)).toEqual({
    owner: 'example',
    repository: 'backups',
  });
  expect(screen.queryByLabelText('GitHub access token')).not.toBeInTheDocument();
});
it('keeps ciphertext upload explicit and clears passwords when the modal closes', async () => {
  const user = await setupRepository();
  const upload = screen.getByRole('button', { name: 'Create encrypted backup' });
  expect(upload).toBeDisabled();
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'synthetic-password');
  await user.type(screen.getByLabelText('Confirm backup password'), 'synthetic-password');
  expect(storage.uploadBackup).not.toHaveBeenCalled();
  await user.click(upload);
  await screen.findByText('Encrypted backup saved to GitHub.');
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await user.click(screen.getByRole('button', { name: 'Manage connection' }));
  expect(screen.getByLabelText('Backup password', { exact: true })).toHaveValue('');
});
it('confirms disconnect for all tabs without removing routes or cloud files', async () => {
  const user = await setupRepository();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  const dialog = screen.getByRole('dialog', { name: 'Disconnect GitHub?' });
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  expect(logoutGitHub).not.toHaveBeenCalled();
  vi.mocked(getGitHubSession).mockResolvedValue({ ...authorized, connected: false });
  await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
  await screen.findByText('Not connected');
  expect(logoutGitHub).toHaveBeenCalledOnce();
  expect(localStorage.getItem(GITHUB_REPOSITORY_KEY)).toBeNull();
});
it('does not pretend disconnect succeeded after a server failure', async () => {
  const user = await setupRepository();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  vi.mocked(logoutGitHub).mockRejectedValue(new ConnectorError('network'));
  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  const modal = screen.getByRole('dialog', { name: 'Disconnect GitHub?' });
  await user.click(within(modal).getByRole('button', { name: 'Disconnect' }));
  await waitFor(() =>
    expect(within(modal).getByRole('alert')).toHaveTextContent('Could not reach GitHub.'),
  );
  expect(localStorage.getItem(GITHUB_REPOSITORY_KEY)).not.toBeNull();
});
it('refreshes status after another tab signs out and drops access to backup operations', async () => {
  const user = await setupRepository();
  vi.mocked(getGitHubSession).mockResolvedValue({ ...authorized, connected: false });
  fireEvent(
    window,
    new StorageEvent('storage', { key: 'roamlet-github-session-change', newValue: 'changed' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Create encrypted backup' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Done' }));
});
it('restores repository choice after reload from the cookie session and local metadata', async () => {
  localStorage.setItem(
    GITHUB_REPOSITORY_KEY,
    JSON.stringify({ owner: 'example', repository: 'backups' }),
  );
  vi.mocked(getGitHubSession).mockResolvedValue(authorized);
  render(<StorageConnections open onClose={vi.fn()} />);
  await waitFor(() => expect(createStorageConnector).toHaveBeenCalled());
  await userEvent.setup().click(screen.getByRole('button', { name: 'Manage connection' }));
  await screen.findByText('Connected to example/backups');
});
it('offers reauthorization when a repository operation finds an expired session', async () => {
  const user = await setupRepository();
  vi.mocked(storage.listBackups).mockRejectedValueOnce(new ConnectorError('auth'));
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  await waitFor(() =>
    expect(screen.getByRole('dialog').querySelector('[role="alert"]')).toHaveTextContent(
      'Your GitHub session has expired',
    ),
  );
  expect(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in with GitHub' }),
  ).toBeEnabled();
});

it('supports Russian setup copy without internal release names', async () => {
  await i18n.changeLanguage('ru');
  render(<StorageConnections open onClose={vi.fn()} />);
  await screen.findByText('Не подключён');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Настроить подключение' }));
  const modal = screen.getByRole('dialog', { name: 'Настройки подключения GitHub' });
  expect(within(modal).getByRole('button', { name: 'Войти через GitHub' })).toBeEnabled();
  expect(modal.textContent).not.toMatch(/пилот|MVP/i);
});
