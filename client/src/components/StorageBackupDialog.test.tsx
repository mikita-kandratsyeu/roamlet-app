import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StorageBackupDialog, type StorageBackupDialogProps } from './StorageBackupDialog';
import { Toaster } from './ui/sonner';
import { listRoutes } from '../domain/storage';

vi.mock('../domain/storage', () => ({ listRoutes: vi.fn() }));

function props(): StorageBackupDialogProps {
  return {
    storage: {
      connection: null,
      operation: null,
      error: null,
      connectionIssue: null,
      backups: [],
      listed: false,
      preview: null,
      success: null,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue(undefined),
      prepareRestore: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      dismissPreview: vi.fn(),
    },
    title: 'Storage backup settings',
    description: 'Keep an encrypted copy of saved routes.',
    enabled: true,
    loading: false,
    connectionContent: <p>Provider account summary</p>,
    privacy: <p>Provider privacy details</p>,
    uploadSuccess: 'Encrypted backup saved.',
    uploadCancelWarning: 'The provider may already have saved this backup.',
    onClose: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(listRoutes).mockReset();
  vi.mocked(listRoutes).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('renders provider-owned content and collapsed privacy without backup panels until enabled', async () => {
  const value = props();
  render(<StorageBackupDialog {...value} enabled={false} />);
  expect(screen.getByText('Provider account summary')).toBeVisible();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Backup password', { exact: true })).not.toBeInTheDocument();
  expect(listRoutes).not.toHaveBeenCalled();
  const privacy = screen.getByText('Privacy and limits').closest('details');
  expect(privacy?.open).toBe(false);
  expect(privacy).toHaveTextContent('Provider privacy details');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Done' }));
  expect(value.storage.cancel).toHaveBeenCalledOnce();
  expect(value.onClose).toHaveBeenCalledOnce();
});

it('clears both creation and restore passwords when the provider target changes', async () => {
  const value = props();
  value.storage.backups = [{ id: 'snapshot', name: 'snapshot.roamlet', size: 100 }];
  const { rerender } = render(<StorageBackupDialog {...value} />);
  const user = userEvent.setup();
  await screen.findByText('0 saved routes will be included');
  await user.type(screen.getByLabelText('Backup password', { exact: true }), 'synthetic-password');
  await user.type(screen.getByLabelText('Confirm backup password'), 'synthetic-password');
  screen.getByRole('tab', { name: 'Create a backup' }).focus();
  await user.keyboard('{ArrowRight}');
  await user.type(screen.getByLabelText('Restore password'), 'restore-secret');
  await user.click(screen.getByRole('button', { name: 'Cloud backup' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'snapshot.roamlet · 1 KiB' }));
  expect(screen.getByRole('button', { name: 'Preview restoration' })).toBeEnabled();
  rerender(
    <StorageBackupDialog
      {...value}
      storage={{ ...value.storage, connection: { provider: 'google-drive' } }}
    />,
  );
  expect(screen.getByLabelText('Restore password')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Cloud backup' })).toHaveTextContent('Choose a backup');
  expect(screen.getByRole('button', { name: 'Preview restoration' })).toBeDisabled();
  await user.click(screen.getByRole('tab', { name: 'Create a backup' }));
  expect(screen.getByLabelText('Backup password', { exact: true })).toHaveValue('');
  expect(screen.getByLabelText('Confirm backup password')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Create encrypted backup' })).toBeDisabled();
  await user.type(
    screen.getByLabelText('Backup password', { exact: true }),
    'next-target-password',
  );
  await user.type(screen.getByLabelText('Confirm backup password'), 'next-target-password');
  rerender(
    <StorageBackupDialog
      {...value}
      storage={{
        ...value.storage,
        connection: { provider: 'github', owner: 'example', repository: 'other-backups' },
      }}
    />,
  );
  expect(screen.getByLabelText('Backup password', { exact: true })).toHaveValue('');
  expect(screen.getByLabelText('Confirm backup password')).toHaveValue('');
});

it('reports a failed local summary with an error Sonner toast using the supplied title', async () => {
  vi.mocked(listRoutes).mockRejectedValueOnce(new Error('Local library unavailable'));
  const value = props();
  render(
    <>
      <Toaster />
      <StorageBackupDialog {...value} />
    </>,
  );
  const alert = await screen.findByRole('alert');
  expect(alert.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');
  expect(alert.closest('[data-sonner-toast]')).toHaveTextContent(value.title);
  expect(alert).toHaveTextContent('Could not read or restore the local library.');
  expect(screen.getByRole('button', { name: 'Create encrypted backup' })).toBeDisabled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('0 saved routes will be included');
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

it('uses the provider upload warning and confirms cancellation before closing', async () => {
  const value = props();
  value.storage.operation = 'uploading';
  render(<StorageBackupDialog {...value} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  const prompt = screen.getByRole('dialog', { name: 'Stop this operation?' });
  expect(prompt).toHaveTextContent(value.uploadCancelWarning);
  expect(within(prompt).getByRole('button', { name: 'Keep working' })).toHaveFocus();
  await user.click(within(prompt).getByRole('button', { name: 'Keep working' }));
  expect(value.storage.cancel).not.toHaveBeenCalled();
  expect(value.onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel operation' }));
  await user.click(screen.getByRole('button', { name: 'Stop and close' }));
  expect(value.storage.cancel).toHaveBeenCalledOnce();
  expect(value.onClose).toHaveBeenCalledOnce();
});

it('does not interrupt atomic local restoration when closing or pressing Escape', async () => {
  const value = props();
  value.storage.operation = 'restoring';
  render(<StorageBackupDialog {...value} />);
  expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Cancel operation' })).not.toBeInTheDocument();
  await userEvent.setup().keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: value.title })).toBeVisible();
  expect(value.storage.cancel).not.toHaveBeenCalled();
  expect(value.onClose).not.toHaveBeenCalled();
});

it('uses a provider-neutral connection operation label and supplied upload success', () => {
  const value = props();
  const { rerender } = render(
    <StorageBackupDialog {...value} storage={{ ...value.storage, operation: 'connecting' }} />,
  );
  expect(screen.getByText('Checking connection')).toBeVisible();
  expect(screen.queryByText(/Checking GitHub/)).not.toBeInTheDocument();
  rerender(<StorageBackupDialog {...value} storage={{ ...value.storage, success: 'uploaded' }} />);
  expect(screen.getByText(value.uploadSuccess)).toBeVisible();
});
