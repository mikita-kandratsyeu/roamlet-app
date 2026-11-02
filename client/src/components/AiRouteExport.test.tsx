import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { Toaster } from './ui/sonner';
import userEvent from '@testing-library/user-event';
import { AiRouteExport } from './AiRouteExport';
import type { PlannedRoute } from '../domain/types';
import i18n from '../i18n';

const route: PlannedRoute = {
  id: 'route',
  name: 'Private name',
  description: '',
  activity: 'hiking',
  source: 'manual',
  segments: [
    [
      [11.4, 47.2],
      [11.5, 47.3],
    ],
  ],
  waypoints: [],
  stats: { distance: 12000, duration: 600 },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const copiedMessage = 'Request copied. Paste it into your AI chat.';
beforeEach(() => render(<Toaster />));
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

it('copies exactly the preview after a click, with location excluded by default', async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  render(<AiRouteExport route={route} />);
  const preview = screen.getByRole('textbox', { name: 'Request preview' });
  expect(preview).toHaveAttribute('readonly');
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Request preview' }).value,
  ).not.toContain('Private name');
  expect(write).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Copy for AI' }));
  expect(write).toHaveBeenCalledExactlyOnceWith((preview as HTMLTextAreaElement).value);
  expect((await screen.findByText(copiedMessage)).closest('[data-sonner-toast]')).toHaveAttribute(
    'data-type',
    'success',
  );
  expect(
    within(screen.getByRole('region', { name: 'For AI' })).queryByText(copiedMessage),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole('checkbox', { name: 'Include names, coordinates and departure date' }),
  );
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Request preview' }).value,
  ).toContain('Private name');
  await waitFor(() => expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument());
  expect(write).toHaveBeenCalledTimes(1);
});

it('keeps manual copying available after a failure and supports retry', async () => {
  const user = userEvent.setup();
  const write = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValueOnce(new Error('Denied'))
    .mockResolvedValue();
  render(<AiRouteExport route={route} />);
  await user.click(screen.getByRole('button', { name: 'Copy for AI' }));
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('copy it manually');
  expect(error.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');
  expect(
    within(screen.getByRole('region', { name: 'For AI' })).queryByRole('alert'),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Request preview' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Copy for AI' }));
  expect((await screen.findByText(copiedMessage)).closest('[data-sonner-toast]')).toHaveAttribute(
    'data-type',
    'success',
  );
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(write).toHaveBeenCalledTimes(2);
});

it('handles browsers without the clipboard API', async () => {
  const user = userEvent.setup();
  const withoutClipboard = Object.create(navigator);
  Object.defineProperty(withoutClipboard, 'clipboard', { value: undefined });
  vi.stubGlobal('navigator', withoutClipboard);
  render(<AiRouteExport route={route} />);
  await user.click(screen.getByRole('button', { name: 'Copy for AI' }));
  expect(await screen.findByRole('alert')).toBeVisible();
});

it('ignores an obsolete copy result after the route changes or the component closes', async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<AiRouteExport route={route} />);
  await user.click(screen.getByRole('button', { name: 'Copy for AI' }));
  expect(screen.getByRole('button', { name: 'Copying…' })).toBeDisabled();
  view.rerender(<AiRouteExport route={{ ...route, stats: { distance: 14000, duration: 900 } }} />);
  finish();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copy for AI' })).toBeEnabled());
  expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Copy for AI' }));
  view.unmount();
  finish();
});

it('supports toast dismissal and removes owned notifications on close', async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const view = render(<AiRouteExport route={route} />);
  await user.click(screen.getByRole('button', { name: 'Copy for AI' }));
  await screen.findByText(copiedMessage);
  screen.getByRole('button', { name: 'Dismiss notification' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Copy for AI' }));
  await screen.findByText(copiedMessage);
  view.unmount();
  await waitFor(() => expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument());
});

it('localizes the interface and request to Russian', async () => {
  await i18n.changeLanguage('ru');
  render(<AiRouteExport route={route} />);
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Предпросмотр запроса' }).value,
  ).toContain('Проанализируй запланированный маршрут');
  expect(screen.getByRole('button', { name: 'Скопировать для ИИ' })).toBeVisible();
});
