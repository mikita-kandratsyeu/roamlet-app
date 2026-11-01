import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StorageConnections } from './StorageConnections';
import { createStorageConnector } from '../services/connectors/registry';
import {
  ConnectorError,
  type StorageConnector,
  type BackupEntry,
} from '../services/connectors/types';
import { encryptBackup } from '../domain/encryptedBackup';
import { exportBackup } from '../domain/backup';
import { routeDb } from '../domain/storage';
import i18n from '../i18n';

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto');
vi.mock('../services/connectors/registry', () => ({ createStorageConnector: vi.fn() }));
let storage: StorageConnector;
const entry: BackupEntry = {
  id: 'roamlet-backups/11111111-1111-4111-8111-111111111111.roamlet',
  name: '11111111-1111-4111-8111-111111111111.roamlet',
  size: 100,
};
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.mocked(createStorageConnector).mockReset();
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
async function connect() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Set up connection' }));
  await user.type(screen.getByLabelText('GitHub owner'), 'example');
  await user.type(screen.getByLabelText('Private repository'), 'backups');
  await user.type(screen.getByLabelText('GitHub access token'), 'synthetic-only-token');
  await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));
  await screen.findByText('Connected to example/backups');
  return user;
}

it('renders a separate connector list, official local logo, status and selection without automatic requests', async () => {
  const onClose = vi.fn();
  render(<StorageConnections open onClose={onClose} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const list = screen.getByRole('list', { name: 'Available connectors' });
  const card = within(list).getByRole('listitem');
  expect(within(card).getByRole('heading', { name: 'GitHub' })).toBeInTheDocument();
  expect(card.querySelector('img')).toHaveAttribute('src', '/github-mark.png');
  expect(screen.getByText('Not connected')).toBeVisible();
  expect(screen.queryByLabelText('GitHub access token')).not.toBeInTheDocument();
  expect(createStorageConnector).not.toHaveBeenCalled();
  const back = screen.getByRole('button', { name: 'Back to map' });
  expect(back).toHaveFocus();
  await userEvent.setup().keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledOnce();
});

it('keeps verified status across page visits but forgets passwords and disconnects from the list', async () => {
  const onClose = vi.fn();
  const { rerender } = render(<StorageConnections open onClose={onClose} />);
  const user = await connect();
  expect(screen.getByText('Connected', { exact: true })).toBeVisible();
  expect(screen.queryByLabelText('GitHub access token')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'synthetic-password');
  rerender(<StorageConnections open={false} onClose={onClose} />);
  rerender(<StorageConnections open onClose={onClose} />);
  expect(screen.getByText('Connected', { exact: true })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Manage connection' }));
  expect(screen.getByLabelText('Backup password', { exact: true })).toHaveValue('');
  expect(storage.checkConnection).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  expect(screen.getByText('Not connected')).toBeVisible();
  expect(screen.getByLabelText('GitHub access token')).toHaveValue('');
});

it('requires matching strong passwords, uploads only on click and exposes an empty list', async () => {
  render(<StorageConnections open onClose={vi.fn()} />);
  const user = await connect();
  const upload = screen.getByRole('button', { name: 'Create encrypted backup' });
  expect(upload).toBeDisabled();
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'synthetic-password');
  await user.type(screen.getByLabelText('Confirm backup password'), 'different');
  expect(upload).toBeDisabled();
  await user.clear(screen.getByLabelText('Confirm backup password'));
  await user.type(screen.getByLabelText('Confirm backup password'), 'synthetic-password');
  expect(upload).toBeEnabled();
  expect(storage.uploadBackup).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  expect(await screen.findByText('No cloud backups yet.')).toBeVisible();
  await user.click(upload);
  expect(await screen.findByText('Encrypted backup saved to GitHub.')).toBeVisible();
});

it('previews before importing and invalidates the preview when its password changes', async () => {
  vi.mocked(storage.listBackups).mockResolvedValue([entry]);
  vi.mocked(storage.downloadBackup).mockResolvedValue(
    await encryptBackup(exportBackup([]), 'synthetic-password'),
  );
  render(<StorageConnections open onClose={vi.fn()} />);
  const user = await connect();
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  await user.selectOptions(await screen.findByLabelText('Cloud backup'), entry.id);
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'synthetic-password');
  await user.click(screen.getByRole('button', { name: 'Preview restoration' }));
  expect(await screen.findByRole('region', { name: 'Library import preview' })).toBeVisible();
  expect(screen.getByLabelText('Conflicting routes')).toHaveValue('copy');
  await user.selectOptions(screen.getByLabelText('Conflicting routes'), 'replace');
  expect(
    screen.getByText('Confirming will replace conflicting saved routes with the backup versions.'),
  ).toBeVisible();
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'x');
  expect(screen.queryByRole('region', { name: 'Library import preview' })).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Backup password', { exact: true }));
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'synthetic-password');
  await user.click(screen.getByRole('button', { name: 'Preview restoration' }));
  await screen.findByRole('region', { name: 'Library import preview' });
  await user.click(screen.getByRole('button', { name: 'Import routes' }));
  expect(
    await screen.findByText(
      'Library restored on this device. The current editor route is unchanged.',
    ),
  ).toBeVisible();
});

it('shows sanitized errors, preserves failing status across visits and supports retry', async () => {
  const onClose = vi.fn();
  const { rerender } = render(<StorageConnections open onClose={onClose} />);
  const user = await connect();
  vi.mocked(storage.listBackups).mockRejectedValueOnce(new ConnectorError('auth'));
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('GitHub rejected the token.');
  expect(screen.getByText('Connection needs attention')).toBeVisible();
  rerender(<StorageConnections open={false} onClose={onClose} />);
  rerender(<StorageConnections open onClose={onClose} />);
  expect(screen.getByText('Connection needs attention')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Manage connection' }));
  await user.click(screen.getByRole('button', { name: 'Refresh cloud backups' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByText('Connected', { exact: true })).toBeVisible();
});

it('cancels a connection on leaving and clears the unsubmitted token', async () => {
  let finish!: () => void;
  vi.mocked(storage.checkConnection).mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const onClose = vi.fn();
  const { rerender } = render(<StorageConnections open onClose={onClose} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Set up connection' }));
  await user.type(screen.getByLabelText('GitHub owner'), 'example');
  await user.type(screen.getByLabelText('Private repository'), 'backups');
  await user.type(screen.getByLabelText('GitHub access token'), 'synthetic-only-token');
  await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));
  await user.click(screen.getByRole('button', { name: 'Back to map' }));
  expect(vi.mocked(storage.checkConnection).mock.calls[0][0]?.aborted).toBe(true);
  rerender(<StorageConnections open={false} onClose={onClose} />);
  finish();
  rerender(<StorageConnections open onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: 'Set up connection' }));
  expect(screen.getByLabelText('GitHub access token')).toHaveValue('');
  expect(screen.getByText('Not connected')).toBeVisible();
});

it('localizes connector list and setup in Russian', async () => {
  await i18n.changeLanguage('ru');
  render(<StorageConnections open onClose={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Подключения' })).toBeVisible();
  expect(screen.getByText('Не подключён')).toBeVisible();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Настроить подключение' }));
  expect(screen.getByLabelText('Токен доступа GitHub')).toBeVisible();
});
