import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StorageConnections } from './StorageConnections';
import { Toaster } from './ui/sonner';
import {
  getGoogleDriveSession,
  logoutGoogleDrive,
} from '../services/connectors/googleDriveSession';
import {
  getGitHubSession,
  getGitHubRepositories,
  logoutGitHub,
} from '../services/connectors/githubSession';
import { createStorageConnector } from '../services/connectors/registry';
import { ConnectorError, type StorageConnector } from '../services/connectors/types';
import { GITHUB_REPOSITORY_KEY } from '../domain/connectorPreferences';
import { decryptBackup } from '../domain/encryptedBackup';
import { routeDb } from '../domain/storage';
import i18n from '../i18n';
const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto');
vi.mock('../services/connectors/googleDriveSession', () => ({
  getGoogleDriveSession: vi.fn(),
  logoutGoogleDrive: vi.fn(),
}));
vi.mock('../services/connectors/githubSession', () => ({
  getGitHubSession: vi.fn(),
  getGitHubRepositories: vi.fn(),
  logoutGitHub: vi.fn(),
}));
vi.mock('../services/connectors/registry', async (original) => ({
  ...(await original<typeof import('../services/connectors/registry')>()),
  createStorageConnector: vi.fn(),
}));
const authorized = {
  available: true,
  connected: true,
  email: 'user@example.test',
  accountId: 'account123',
};
const entry = { id: 'file_123', name: '11111111-1111-4111-8111-111111111111.roamlet', size: 100 };
let googleAdapter: StorageConnector;
let githubAdapter: StorageConnector;
const card = (name: string) => within(screen.getByRole('heading', { name }).closest('article')!);
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('BroadcastChannel', undefined);
  localStorage.removeItem(GITHUB_REPOSITORY_KEY);
  vi.mocked(getGoogleDriveSession)
    .mockReset()
    .mockResolvedValue({ available: true, connected: false });
  vi.mocked(logoutGoogleDrive).mockReset().mockResolvedValue(undefined);
  vi.mocked(getGitHubSession).mockReset().mockResolvedValue({ available: false, connected: false });
  vi.mocked(logoutGitHub).mockReset().mockResolvedValue(undefined);
  vi.mocked(getGitHubRepositories).mockReset().mockResolvedValue([]);
  googleAdapter = {
    checkConnection: vi.fn().mockResolvedValue(undefined),
    listBackups: vi.fn().mockResolvedValue([]),
    uploadBackup: vi.fn().mockResolvedValue(entry),
    downloadBackup: vi.fn(),
  };
  githubAdapter = {
    checkConnection: vi.fn().mockResolvedValue(undefined),
    listBackups: vi.fn().mockResolvedValue([]),
    uploadBackup: vi.fn(),
    downloadBackup: vi.fn(),
  };
  vi.mocked(createStorageConnector)
    .mockReset()
    .mockImplementation((config) =>
      config.provider === 'google-drive' ? googleAdapter : githubAdapter,
    );
  await routeDb.routes.clear();
  render(<Toaster />);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup() {
  vi.mocked(getGoogleDriveSession).mockResolvedValue(authorized);
  render(<StorageConnections open onClose={vi.fn()} />);
  await waitFor(() =>
    expect(createStorageConnector).toHaveBeenCalledWith({ provider: 'google-drive' }),
  );
  const user = userEvent.setup();
  await user.click(card('Google Drive').getByRole('button', { name: 'Manage connection' }));
  await screen.findByRole('tab', { name: 'Create a backup' });
  return user;
}
it('places Google Drive first, with its own logo, state and sign-in modal', async () => {
  render(<StorageConnections open onClose={vi.fn()} />);
  await card('Google Drive').findByText('Not connected');
  const cards = screen.getAllByRole('listitem');
  expect(within(cards[0]).getByRole('heading')).toHaveTextContent('Google Drive');
  expect(within(cards[1]).getByRole('heading')).toHaveTextContent('GitHub');
  expect(cards[0].querySelector('img')).toHaveAttribute('src', '/google-drive-2026.png');
  await userEvent
    .setup()
    .click(card('Google Drive').getByRole('button', { name: 'Set up connection' }));
  const dialog = screen.getByRole('dialog', { name: 'Google Drive connection settings' });
  expect(within(dialog).getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  expect(dialog.querySelector('select')).toBeNull();
  expect(dialog.querySelector('details details')).toBeNull();
  expect(within(dialog).getAllByText('Privacy and limits')).toHaveLength(1);
  expect(within(dialog).getByText(/Roamlet can access only its own data/)).toBeVisible();
  expect(getGitHubRepositories).not.toHaveBeenCalled();
});
it('shares encrypted backup and restore UX without GitHub configuration or requests', async () => {
  const user = await setup();
  expect(screen.queryByRole('button', { name: 'Private repository' })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'synthetic-password');
  await user.type(screen.getByLabelText('Confirm backup password'), 'synthetic-password');
  await user.click(screen.getByRole('button', { name: 'Create encrypted backup' }));
  await screen.findByText('Encrypted backup saved to Google Drive.');
  const bytes = vi.mocked(googleAdapter.uploadBackup).mock.calls[0][0];
  expect((await decryptBackup(bytes, 'synthetic-password')).routes).toEqual([]);
  expect(githubAdapter.checkConnection).not.toHaveBeenCalled();
  expect(githubAdapter.uploadBackup).not.toHaveBeenCalled();
  vi.mocked(googleAdapter.listBackups).mockResolvedValue([entry]);
  vi.mocked(googleAdapter.downloadBackup).mockResolvedValue(bytes);
  await user.click(screen.getByRole('tab', { name: 'Restore a backup' }));
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  await user.click(screen.getByRole('button', { name: 'Cloud backup' }));
  await user.click(screen.getByRole('menuitemradio', { name: new RegExp(entry.name) }));
  await user.type(screen.getByLabelText('Restore password'), 'synthetic-password');
  await user.click(screen.getByRole('button', { name: 'Preview restoration' }));
  await screen.findByText('0 routes to import');
  expect(screen.getByRole('button', { name: 'Conflicting routes' })).toHaveTextContent(
    'Import copies',
  );
  await user.click(screen.getByRole('button', { name: 'Import routes' }));
  await screen.findByText(
    'Library restored on this device. The current editor route is unchanged.',
  );
});
it('displays expired Google access in Sonner and offers sign-in without affecting GitHub', async () => {
  const user = await setup();
  vi.mocked(googleAdapter.listBackups).mockRejectedValueOnce(new ConnectorError('auth'));
  await user.click(screen.getByRole('tab', { name: 'Restore a backup' }));
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Your Google Drive session has expired');
  expect(alert.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in with Google' }),
  ).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(card('GitHub').getByText('Unavailable')).toBeVisible();
});
it('confirms Google-only logout across tabs while preserving GitHub repository metadata', async () => {
  localStorage.setItem(
    GITHUB_REPOSITORY_KEY,
    JSON.stringify({ owner: 'example', repository: 'backups' }),
  );
  const user = await setup();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await user.click(card('Google Drive').getByRole('button', { name: 'Disconnect Google Drive' }));
  const prompt = screen.getByRole('dialog', { name: 'Disconnect Google Drive?' });
  expect(within(prompt).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.click(within(prompt).getByRole('button', { name: 'Disconnect' }));
  await card('Google Drive').findByText('Not connected');
  expect(logoutGoogleDrive).toHaveBeenCalledOnce();
  expect(logoutGitHub).not.toHaveBeenCalled();
  expect(localStorage.getItem(GITHUB_REPOSITORY_KEY)).not.toBeNull();
});
it('reacts to Google logout in another tab and removes backup actions', async () => {
  await setup();
  vi.mocked(getGoogleDriveSession).mockResolvedValue({ available: true, connected: false });
  fireEvent(
    window,
    new StorageEvent('storage', {
      key: 'roamlet-google-drive-session-change',
      newValue: 'changed',
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Create encrypted backup' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
});
it('does not keep a previous Google account backup list after account change', async () => {
  const user = await setup();
  vi.mocked(googleAdapter.listBackups).mockResolvedValue([entry]);
  await user.click(screen.getByRole('tab', { name: 'Restore a backup' }));
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  await screen.findByRole('button', { name: 'Cloud backup' });
  vi.mocked(getGoogleDriveSession).mockResolvedValue({
    ...authorized,
    email: 'other@example.test',
    accountId: 'different123',
  });
  fireEvent(window, new Event('focus'));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Cloud backup' })).not.toBeInTheDocument(),
  );
  await screen.findByText('Signed in as other@example.test');
});
it('shows Google callback errors in Sonner and does not present GitHub errors', async () => {
  window.history.replaceState(null, '', '/?connectors=google-drive&google=error');
  render(<StorageConnections open onClose={vi.fn()} />);
  window.history.replaceState(null, '', '/');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Google authorization was cancelled or failed');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});
it('keeps Google unavailable without blocking GitHub or the map', async () => {
  vi.mocked(getGoogleDriveSession).mockResolvedValue({ available: false, connected: false });
  const close = vi.fn();
  render(<StorageConnections open onClose={close} />);
  await card('Google Drive').findByText('Unavailable');
  const user = userEvent.setup();
  await user.click(card('Google Drive').getByRole('button', { name: 'Set up connection' }));
  expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await user.click(screen.getByRole('button', { name: 'Back to map' }));
  expect(close).toHaveBeenCalledOnce();
});
it('uses localized Google product copy and shared password/backup controls', async () => {
  await i18n.changeLanguage('ru');
  vi.mocked(getGoogleDriveSession).mockResolvedValue(authorized);
  render(<StorageConnections open onClose={vi.fn()} />);
  await waitFor(() => expect(createStorageConnector).toHaveBeenCalled());
  await userEvent
    .setup()
    .click(card('Google Drive').getByRole('button', { name: 'Управлять подключением' }));
  expect(screen.getByRole('dialog', { name: 'Настройки подключения Google Drive' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Создать копию' })).toBeVisible();
});
