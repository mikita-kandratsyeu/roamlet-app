import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StorageConnections } from './StorageConnections';
import {
  getGoogleDriveSession,
  logoutGoogleDrive,
} from '../services/connectors/googleDriveSession';
import { Toaster } from './ui/sonner';
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
vi.mock('../services/connectors/googleDriveSession', () => ({
  getGoogleDriveSession: vi.fn(),
  logoutGoogleDrive: vi.fn(),
}));
function githubCard() {
  return within(screen.getByRole('heading', { name: 'GitHub' }).closest('article')!);
}
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
  render(<Toaster />);
  vi.mocked(getGoogleDriveSession)
    .mockReset()
    .mockResolvedValue({ available: false, connected: false });
  vi.mocked(logoutGoogleDrive).mockReset().mockResolvedValue(undefined);
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
  await user.click(screen.getByRole('button', { name: 'Private repository' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'example/backups' }));
  await user.click(screen.getByRole('button', { name: 'Use this repository' }));
  await screen.findByText('Connected to example/backups');
  return user;
}
it('renders a searchable card grid and opens setup as an accessible modal with restored focus', async () => {
  render(<StorageConnections open onClose={vi.fn()} />);
  await screen.findByText('Not connected');
  const card = screen.getByRole('heading', { name: 'GitHub' }).closest('article')!;
  expect(card.querySelector('img')).toHaveAttribute('src', '/github-mark.png');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const search = screen.getByRole('textbox', { name: 'Search connectors' });
  expect(search.closest('label')).toHaveClass('library-search');
  expect(search.closest('.library-toolbar')).toBeInTheDocument();
  expect(search.closest('label')?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByRole('button', { name: 'All connectors' })).toHaveClass(
    'library-favorite-filter',
  );
  expect(screen.getByRole('button', { name: 'All connectors' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const user = userEvent.setup();
  const setup = githubCard().getByRole('button', { name: 'Set up connection' });
  await user.click(setup);
  const modal = screen.getByRole('dialog', { name: 'GitHub connection settings' });
  expect(modal).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeEnabled();
  expect(modal.querySelector('input[type=password]')).toBeNull();
  expect(
    within(modal).getByText('Choose which private repositories Roamlet can use for your backups.'),
  ).toBeVisible();
  expect(modal.textContent).not.toMatch(/personal access token|install.*GitHub App|HttpOnly/i);
  const privacy = within(modal).getByText('Privacy and limits').closest('details');
  expect(privacy?.open).toBe(false);
  expect(privacy).toHaveTextContent(
    'Roamlet processes GitHub access tokens without storing them in a database',
  );
  expect(screen.getByRole('link', { name: 'Manage repository access' })).toHaveAttribute(
    'href',
    authorized.installUrl,
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(setup).toHaveFocus());
  await user.type(screen.getByRole('textbox', { name: 'Search connectors' }), 'missing-service');
  expect(screen.getByText('No connectors match this filter.')).toBeVisible();
  await user.clear(screen.getByRole('textbox', { name: 'Search connectors' }));
  await user.click(screen.getByRole('button', { name: 'Connected connectors' }));
  expect(screen.getByRole('button', { name: 'Connected connectors' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'All connectors' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(screen.getByText('No connectors match this filter.')).toBeVisible();
});
it('disables authorization with missing server configuration without hiding local navigation', async () => {
  vi.mocked(getGitHubSession).mockResolvedValue({ available: false, connected: false });
  const close = vi.fn();
  render(<StorageConnections open onClose={close} />);
  await githubCard().findByText('Unavailable');
  await userEvent.setup().click(githubCard().getByRole('button', { name: 'Set up connection' }));
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
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach GitHub.'),
  );
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert').closest('[data-sonner-toast]')).toHaveAttribute(
    'data-type',
    'error',
  );
  expect(modal.querySelector('[role="alert"]')).toBeNull();
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
  await user.click(screen.getByRole('tab', { name: 'Restore a backup' }));
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Your GitHub session has expired'),
  );
  expect(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in with GitHub' }),
  ).toBeEnabled();
});

it('shows session failures once in Sonner, keeps card status and permits a fresh retry', async () => {
  vi.mocked(getGitHubSession).mockRejectedValueOnce(new ConnectorError('network'));
  render(<StorageConnections open onClose={vi.fn()} />);
  const user = userEvent.setup();
  const alert = await screen.findByRole('alert');
  expect(alert.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByText('Connection needs attention')).toBeVisible();
  screen.getByRole('button', { name: 'Dismiss notification' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  await user.type(screen.getByRole('textbox', { name: 'Search connectors' }), 'Git');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Not connected');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  vi.mocked(getGitHubSession).mockRejectedValueOnce(new ConnectorError('network'));
  fireEvent(window, new Event('focus'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach GitHub.');
});

it('shows OAuth callback failure as a dismissible Sonner toast, not a page banner', async () => {
  window.history.replaceState(null, '', '/?github=error');
  render(<StorageConnections open onClose={vi.fn()} />);
  window.history.replaceState(null, '', '/');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('GitHub authorization was cancelled or failed.');
  expect(alert.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');
  expect(
    screen.getByRole('region', { name: 'Connections' }).querySelector('[role="alert"]'),
  ).toBeNull();
  screen.getByRole('button', { name: 'Dismiss notification' }).focus();
  await userEvent.setup().keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

it('keeps connected settings compact and edits repository only on request', async () => {
  const user = await setupRepository();
  expect(screen.queryByRole('button', { name: 'Private repository' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Create a backup' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Change repository' }));
  expect(screen.getByRole('button', { name: 'Private repository' })).toHaveTextContent(
    'example/backups',
  );
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('button', { name: 'Private repository' })).not.toBeInTheDocument();
  expect(screen.getByRole('tablist', { name: 'Backup actions' })).toBeVisible();
});

it('uses keyboard tabs, restores empty-state action and retains passwords between tabs', async () => {
  const user = await setupRepository();
  await screen.findByText('0 saved routes will be included');
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'synthetic-password');
  const create = screen.getByRole('tab', { name: 'Create a backup' });
  create.focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Restore a backup' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.queryByLabelText('Backup password', { exact: true })).not.toBeInTheDocument();
  expect(storage.listBackups).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  await screen.findByText('No cloud backups yet.');
  await user.click(screen.getByRole('button', { name: 'Create a backup' }));
  expect(screen.getByLabelText('Backup password', { exact: true })).toHaveValue(
    'synthetic-password',
  );
});

it('explains password constraints next to inputs without firing error toasts', async () => {
  const user = await setupRepository();
  const password = screen.getByLabelText('Backup password', { exact: true });
  await user.type(password, 'short');
  await user.tab();
  expect(password).toHaveAttribute('aria-invalid', 'true');
  expect(password).toHaveAccessibleDescription('Use at least 12 characters.');
  const confirmation = screen.getByLabelText('Confirm backup password');
  await user.type(confirmation, 'different');
  await user.tab();
  expect(confirmation).toHaveAttribute('aria-invalid', 'true');
  expect(confirmation).toHaveAccessibleDescription('Passwords do not match.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create encrypted backup' })).toBeDisabled();
});

it('requires confirmation to stop an upload and ignores its late completion', async () => {
  let finish!: (value: typeof entry) => void;
  const user = await setupRepository();
  vi.mocked(storage.uploadBackup).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'synthetic-password');
  await user.type(screen.getByLabelText('Confirm backup password'), 'synthetic-password');
  await user.click(screen.getByRole('button', { name: 'Create encrypted backup' }));
  await waitFor(() => expect(storage.uploadBackup).toHaveBeenCalled());
  const signal = vi.mocked(storage.uploadBackup).mock.calls[0][1];
  await user.click(screen.getByRole('button', { name: 'Done' }));
  const prompt = screen.getByRole('dialog', { name: 'Stop this operation?' });
  expect(within(prompt).getByRole('button', { name: 'Keep working' })).toHaveFocus();
  expect(signal?.aborted).toBe(false);
  expect(prompt).toHaveTextContent('The backup may already have reached GitHub.');
  await user.click(within(prompt).getByRole('button', { name: 'Keep working' }));
  expect(signal?.aborted).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await user.click(screen.getByRole('button', { name: 'Stop and close' }));
  expect(signal?.aborted).toBe(true);
  finish(entry);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText('Encrypted backup saved to GitHub.')).not.toBeInTheDocument();
});

it('uses the planner dropdown in the dialog with keyboard selection and focus restoration', async () => {
  const user = await setupRepository();
  await user.click(screen.getByRole('button', { name: 'Change repository' }));
  const trigger = screen.getByRole('button', { name: 'Private repository' });
  expect(trigger).toHaveClass('planner-choice');
  expect(screen.getByRole('dialog').querySelector('select')).toBeNull();
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menu')).toHaveClass('planner-choice-menu');
  expect(screen.getByRole('menuitemradio', { name: 'example/backups' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.getByRole('dialog', { name: 'GitHub connection settings' })).toBeVisible();
  await user.click(trigger);
  await user.click(screen.getByRole('menuitemradio', { name: 'Choose a repository' }));
  expect(screen.getByRole('button', { name: 'Use this repository' })).toBeDisabled();
});

it('explains an empty accessible repository list after loading it', async () => {
  vi.mocked(getGitHubSession).mockResolvedValue(authorized);
  vi.mocked(getGitHubRepositories).mockResolvedValue([]);
  render(<StorageConnections open onClose={vi.fn()} />);
  await screen.findByText('Connected', { exact: true });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Manage connection' }));
  await user.click(screen.getByRole('button', { name: 'Load accessible repositories' }));
  expect(
    await screen.findByText(
      'No accessible private repositories yet. Grant repository access, then reload the list.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Use this repository' })).toBeDisabled();
});

it('supports Russian setup copy without internal release names', async () => {
  await i18n.changeLanguage('ru');
  render(<StorageConnections open onClose={vi.fn()} />);
  await screen.findByText('Не подключён');
  await userEvent.setup().click(githubCard().getByRole('button', { name: 'Настроить подключение' }));
  const modal = screen.getByRole('dialog', { name: 'Настройки подключения GitHub' });
  expect(within(modal).getByRole('button', { name: 'Войти через GitHub' })).toBeEnabled();
  expect(modal.textContent).not.toMatch(/пилот|MVP/i);
});
