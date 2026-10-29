import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Notification } from './Notification';
import { Toaster } from './ui/sonner';
import { ThemeProvider } from '../theme';
import i18n from '../i18n';

const props = { title: 'Notification', message: 'Route saved.' };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('uses a Sonner success toast and automatically dismisses it', async () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  render(
    <>
      <Toaster />
      <Notification {...props} variant="success" duration={100} onDismiss={onDismiss} />
    </>,
  );
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText(props.message).closest('[data-sonner-toast]')).toHaveAttribute(
    'data-type',
    'success',
  );
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(screen.queryByText(props.message)).not.toBeInTheDocument();
});

it('keeps errors actionable, supports dismissal and does not replay on unrelated renders', async () => {
  const onRetry = vi.fn();
  const onDismiss = vi.fn();
  const content = (label: string) => (
    <>
      <Toaster />
      <Notification
        {...props}
        variant="error"
        onDismiss={onDismiss}
        actions={<button onClick={onRetry}>{label}</button>}
      />
    </>
  );
  const view = render(content('Retry routing'));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry routing' }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert')).toHaveTextContent(props.message);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  await waitFor(() => expect(screen.queryByText(props.message)).not.toBeInTheDocument());
  view.rerender(content('Retry again'));
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(screen.queryByText(props.message)).not.toBeInTheDocument();
});

it('updates active notification copy and close labels when the language changes', async () => {
  const view = render(
    <>
      <Toaster />
      <Notification {...props} variant="error" />
    </>,
  );
  await screen.findByText(props.message);
  await act(() => i18n.changeLanguage('ru'));
  view.rerender(
    <>
      <Toaster />
      <Notification title={i18n.t('Notification')} message="Маршрут сохранён." variant="error" />
    </>,
  );
  expect(await screen.findByText('Маршрут сохранён.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Закрыть уведомление' })).toBeInTheDocument();
  expect(screen.queryByText(props.message)).not.toBeInTheDocument();
});

it('follows the resolved theme', async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'dark', setItem: vi.fn() });
  render(
    <ThemeProvider>
      <Toaster />
      <Notification {...props} />
    </ThemeProvider>,
  );
  const message = await screen.findByText(props.message);
  expect(message.closest('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'dark');
});

it('removes notifications when their owner unmounts', async () => {
  const view = render(
    <>
      <Toaster />
      <Notification {...props} variant="error" />
    </>,
  );
  await screen.findByText(props.message);
  view.rerender(<Toaster />);
  await waitFor(() => expect(screen.queryByText(props.message)).not.toBeInTheDocument());
});
