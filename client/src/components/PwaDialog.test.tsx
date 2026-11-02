import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { PwaDialog } from './PwaDialog';
import type { usePwa } from '../hooks/usePwa';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});
function setup(overrides: Partial<ReturnType<typeof usePwa>> = {}, online = true) {
  const pwa: ReturnType<typeof usePwa> = {
    offlineStatus: 'ready',
    updateAvailable: false,
    installed: false,
    installAvailable: false,
    installPending: false,
    installError: false,
    install: vi.fn(async () => {}),
    retryOffline: vi.fn(async () => {}),
    storageStatus: 'best-effort',
    storagePending: false,
    storageDeclined: false,
    requestStorage: vi.fn(async () => {}),
    ...overrides,
  };
  const onLibrary = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <PwaDialog pwa={pwa} online={online} onLibrary={onLibrary} onClose={onClose} />,
  );
  return { pwa, onLibrary, onClose, view, user: userEvent.setup() };
}
it('separates offline features from network features without asking for storage automatically', async () => {
  const { pwa, user, onLibrary } = setup();
  expect(screen.getByText('Ready to work offline')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Available offline' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Internet required' })).toBeVisible();
  expect(pwa.requestStorage).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Request storage protection' }));
  expect(pwa.requestStorage).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Open My routes' }));
  expect(onLibrary).toHaveBeenCalledOnce();
});
it('offers installation only when available and keeps manual instructions accessible', async () => {
  const { view, pwa, user } = setup();
  expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  await user.click(screen.getByText('Installation instructions'));
  expect(screen.getByText(/iPhone \/ iPad:/)).toBeVisible();
  view.rerender(
    <PwaDialog
      pwa={{ ...pwa, installAvailable: true }}
      online
      onLibrary={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Install app' }));
  expect(pwa.install).toHaveBeenCalledOnce();
});
it('does not repeat installation or storage requests while pending', () => {
  setup({ installAvailable: true, installPending: true, storagePending: true });
  expect(screen.getByRole('button', { name: 'Install app' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Request storage protection' })).toBeDisabled();
});
it('shows installed and persistent states without promising protection from clearing data', () => {
  setup({ installed: true, storageStatus: 'persistent' });
  expect(screen.getByText('Roamlet is open as an installed app.')).toBeVisible();
  expect(screen.getByText('Persistent storage granted')).toBeVisible();
  expect(screen.queryByText('Installation instructions')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request storage protection' })).toBeNull();
  expect(screen.getByText(/clearing site data still deletes routes/)).toBeVisible();
});
it('explains storage denial and install failures inline', () => {
  setup({ storageDeclined: true, installError: true });
  expect(screen.getByText(/The browser did not grant protection/)).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Installation could not be opened');
});
it('offers offline retry online but disables it without network', async () => {
  const { pwa, view, user } = setup({ offlineStatus: 'error' });
  await user.click(screen.getByRole('button', { name: 'Retry offline preparation' }));
  expect(pwa.retryOffline).toHaveBeenCalledOnce();
  view.rerender(<PwaDialog pwa={pwa} online={false} onLibrary={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Retry offline preparation' })).toBeDisabled();
  expect(screen.getByText('Reconnect to prepare the app for offline use.')).toBeVisible();
});
it.each(['checking', 'unsupported', 'development'] as const)(
  'never claims readiness in %s state',
  (offlineStatus) => {
    setup({ offlineStatus, storageStatus: 'unsupported' });
    expect(screen.queryByText('Ready to work offline')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry offline preparation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request storage protection' })).toBeNull();
  },
);
it('keeps update information passive and supports Russian copy', async () => {
  await i18n.changeLanguage('ru');
  const { user, onClose } = setup({ updateAvailable: true });
  expect(screen.getByRole('dialog', { name: 'Приложение на устройстве' })).toBeVisible();
  expect(screen.getByText(/Обновление готово/)).toHaveTextContent('не во время редактирования');
  expect(screen.queryByRole('button', { name: /Обновить/ })).toBeNull();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledOnce();
});
