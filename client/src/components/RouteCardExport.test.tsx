import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RouteCardExport } from './RouteCardExport';
import { generateRouteCard } from '../services/routeCard';
import type { PlannedRoute } from '../domain/types';
import i18n from '../i18n';

vi.mock('../services/routeCard', () => ({ generateRouteCard: vi.fn() }));
const route: PlannedRoute = {
  id: 'route',
  name: 'Forest walk',
  description: '',
  activity: 'hiking',
  segments: [
    [
      [11, 47, 100],
      [11.1, 47, 130],
    ],
  ],
  waypoints: [],
  stats: { distance: 12400, duration: 600, ascent: 30 },
  source: 'gpx',
  createdAt: '',
  updatedAt: '',
};
const blob = new Blob(['png'], { type: 'image/png' });
const revoke = vi.fn();
beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.mocked(generateRouteCard).mockReset().mockResolvedValue(blob);
  revoke.mockClear();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:card'), revokeObjectURL: revoke }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps privacy guidance compact, accessible and expandable without generating', async () => {
  const user = userEvent.setup();
  render(<RouteCardExport route={route} />);
  const details = screen.getByText('Privacy details').closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(screen.getByText('0 shows the whole route. Only the image is changed.')).toBeVisible();
  expect(screen.getByRole('spinbutton')).toHaveAttribute(
    'aria-describedby',
    'route-card-privacy-hint',
  );
  await user.click(screen.getByText('Privacy details'));
  expect(details).toHaveAttribute('open');
  expect(screen.getByText(/Hides all route portions/)).toBeVisible();
  expect(generateRouteCard).not.toHaveBeenCalled();
});

it('generates on button press, downloads the same PNG, and preserves the route', async () => {
  const original = JSON.stringify(route);
  const user = userEvent.setup();
  render(<RouteCardExport route={route} elevationGain={30} />);
  expect(generateRouteCard).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Download PNG' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByRole('img', { name: 'Generated route image' })).toHaveAttribute(
    'src',
    'blob:card',
  );
  expect(generateRouteCard).toHaveBeenCalledWith(
    expect.objectContaining({
      format: 'post',
      theme: 'light',
      privacyRadius: 0,
      title: 'Forest walk',
      activity: 'hiking',
      plannedLabel: 'Planned route',
      metrics: [
        { label: 'Distance', value: '12.4 km' },
        { label: 'Elevation gain', value: '30 m' },
      ],
    }),
    expect.any(AbortSignal),
  );
  await user.click(screen.getByRole('button', { name: 'Download PNG' }));
  const click = vi.mocked(HTMLAnchorElement.prototype.click);
  expect(click.mock.instances[0]).toHaveAttribute('download', 'roamlet-route-post.png');
  expect(click.mock.instances[0]).toHaveAttribute('href', 'blob:card');
  expect(generateRouteCard).toHaveBeenCalledOnce();
  expect(JSON.stringify(route)).toBe(original);
});

it('invalidates the preview after settings change, validates privacy and localizes requests', async () => {
  const user = userEvent.setup();
  render(<RouteCardExport route={route} />);
  await user.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByRole('img');
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Hide around start and finish (metres)' }),
    { target: { value: '500' } },
  );
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(revoke).toHaveBeenCalledWith('blob:card');
  expect(generateRouteCard).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('radio', { name: /Story/ }));
  await user.click(screen.getByRole('radio', { name: 'Dark' }));
  await act(async () => {
    await i18n.changeLanguage('ru');
  });
  await user.click(screen.getByRole('button', { name: 'Создать предпросмотр' }));
  await screen.findByRole('img');
  expect(generateRouteCard).toHaveBeenLastCalledWith(
    expect.objectContaining({
      format: 'story',
      theme: 'dark',
      privacyRadius: 500,
      activityLabel: 'Пеший поход',
      plannedLabel: 'План маршрута',
    }),
    expect.any(AbortSignal),
  );
  const radius = screen.getByRole('spinbutton');
  for (const value of ['', '-1', '10001', '1.5']) {
    fireEvent.change(radius, { target: { value } });
    expect(screen.getByRole('button', { name: 'Создать предпросмотр' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('от 0 до 10000');
  }
});

it('announces pending work, cancels, reports errors and retries', async () => {
  let resolve!: (blob: Blob) => void;
  vi.mocked(generateRouteCard).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const user = userEvent.setup();
  render(<RouteCardExport route={route} />);
  await user.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(screen.getByRole('status')).toHaveTextContent('Generating image…');
  const signal = vi.mocked(generateRouteCard).mock.calls[0][1];
  await user.click(screen.getByRole('button', { name: 'Cancel generation' }));
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(blob);
  });
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  vi.mocked(generateRouteCard).mockRejectedValueOnce(
    new Error('No route remains visible. Reduce the privacy radius.'),
  );
  await user.click(screen.getByRole('button', { name: 'Create preview' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No route remains visible');
  await user.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByRole('img');
});

it('shares only when supported, ignores share cancellation, and retains download on failure', async () => {
  const share = vi
    .fn()
    .mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))
    .mockRejectedValueOnce(new Error('Failed'));
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
  const user = userEvent.setup();
  const { unmount } = render(<RouteCardExport route={route} />);
  await user.click(screen.getByRole('button', { name: 'Create preview' }));
  await screen.findByRole('img');
  await user.click(screen.getByRole('button', { name: 'Share image' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Share image' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Download it instead');
  expect(share).toHaveBeenCalledWith({ files: [expect.any(File)] });
  expect(screen.getByRole('button', { name: 'Download PNG' })).toBeEnabled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Share image' })).toBeEnabled());
  unmount();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
});
