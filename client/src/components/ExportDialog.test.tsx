import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from './ui/sonner';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportDialog } from './ExportDialog';
import type { PlannedRoute } from '../domain/types';
import i18n from '../i18n';
import { generateRouteCard } from '../services/routeCard';

vi.mock('../services/routeCard', () => ({ generateRouteCard: vi.fn() }));

vi.mock('./ExportRouteMap', () => ({
  ExportRouteMap: () => <figure aria-label="Route map preview" />,
}));

const route: PlannedRoute = {
  id: 'route',
  name: 'Forest walk',
  description: 'Original description',
  activity: 'hiking',
  segments: [
    [
      [11.4, 47.2, 600],
      [11.5, 47.3, 630],
    ],
  ],
  waypoints: [],
  stats: { distance: 12400, duration: 600 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  source: 'gpx',
};

beforeEach(() => render(<Toaster />));
afterEach(() => cleanup());

describe('ExportDialog', () => {
  it('opens AI export locally and returns to unchanged GPX export', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<ExportDialog route={route} onDownload={onDownload} onClose={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'For AI' }));
    expect(screen.getByRole('textbox', { name: 'Request preview' })).toBeVisible();
    expect(screen.queryByRole('figure', { name: 'Route map preview' })).not.toBeInTheDocument();
    expect(onDownload).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'GPX' }));
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveValue('Forest walk.gpx');
    expect(screen.getByRole('button', { name: 'Download GPX' })).toBeVisible();
  });
  it('switches to on-demand image export and back without generating or downloading', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<ExportDialog route={route} onDownload={onDownload} onClose={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'For social media' }));
    expect(screen.getByRole('region', { name: 'Image for social media' })).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveClass('wide');
    expect(screen.queryByRole('figure', { name: 'Route map preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Elevation gain' })).not.toBeInTheDocument();
    expect(generateRouteCard).not.toHaveBeenCalled();
    expect(onDownload).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'GPX' }));
    expect(screen.getByRole('dialog')).not.toHaveClass('wide');
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveValue('Forest walk.gpx');
    expect(screen.getByRole('button', { name: 'Download GPX' })).toBeVisible();
  });
  it('shows route details and a collapsed guide without downloading', () => {
    const onDownload = vi.fn();
    render(<ExportDialog route={route} onDownload={onDownload} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Export route' })).toBeVisible();
    expect(screen.getByText('Forest walk')).toBeVisible();
    expect(screen.getByRole('figure', { name: 'Route map preview' })).toBeVisible();
    expect(screen.getByText('12.4 km')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveValue('Forest walk.gpx');
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveFocus();
    expect(screen.getByText('How to import into Komoot').closest('details')).not.toHaveAttribute(
      'open',
    );
    expect(screen.getByText('How to import into Strava').closest('details')).not.toHaveAttribute('open');
    expect(onDownload).not.toHaveBeenCalled();
  });

  it('summarizes activity, original time and the actual exported geometry counts', () => {
    const snapshot: PlannedRoute = {
      ...route,
      activity: 'cycling',
      segments: [...route.segments, [], [[12, 48, 500]]],
      waypoints: [{ id: 'stop', name: 'Meeting point', coordinate: [11, 47] }],
    };
    render(<ExportDialog route={snapshot} onDownload={vi.fn()} onClose={vi.fn()} />);
    const summary = screen.getByRole('region', { name: 'Route details' });
    const value = (label: string) => within(summary).getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(value('Activity')).toHaveTextContent('Cycling');
    expect(value('Distance')).toHaveTextContent('12.4 km');
    expect(value('Original time estimate')).toHaveTextContent('10 min');
    expect(value('Track points')).toHaveTextContent('3');
    expect(value('GPX segments')).toHaveTextContent('3');
    expect(value('Waypoints')).toHaveTextContent('1');
    expect(within(summary).queryByText('Elevation gain')).not.toBeInTheDocument();
  });

  it.each(['gpx', 'openrouteservice'] as const)('shows available heights, including zero, for %s', (source) => {
    const snapshot: PlannedRoute = {
      ...route,
      source,
      ...(source === 'openrouteservice' ? { elevationSource: 'openrouteservice' as const } : {}),
      stats: { ...route.stats, ascent: 30, descent: 0 },
    };
    render(<ExportDialog route={snapshot} onDownload={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Elevation gain', { selector: 'dt' }).nextElementSibling).toHaveTextContent('30 m');
    expect(screen.getByText('Elevation loss', { selector: 'dt' }).nextElementSibling).toHaveTextContent('0 m');
  });

  it.each(['missing', 'partial', 'manual', 'legacy-mapbox'] as const)(
    'does not claim elevation metrics for %s heights',
    (kind) => {
      const snapshot: PlannedRoute = {
        ...route,
        stats: { ...route.stats, ascent: 30, descent: 0 },
        ...(kind === 'missing' ? { segments: [[[11, 47], [12, 48]]] } : {}),
        ...(kind === 'partial' ? { segments: [[[11, 47, 100], [12, 48]]] } : {}),
        ...(kind === 'manual' ? { source: 'manual' } : {}),
        ...(kind === 'legacy-mapbox' ? { source: 'mapbox' } : {}),
      };
      render(<ExportDialog route={snapshot} onDownload={vi.fn()} onClose={vi.fn()} />);
      const summary = screen.getByRole('region', { name: 'Route details' });
      expect(within(summary).queryByText('Elevation gain')).not.toBeInTheDocument();
      expect(within(summary).queryByText('Elevation loss')).not.toBeInTheDocument();
    },
  );

  it('sanitizes the file name without changing the exported route', () => {
    const onDownload = vi.fn();
    render(<ExportDialog route={route} onDownload={onDownload} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), {
      target: { value: 'Weekend/trip.GPX' },
    });
    expect(screen.getByText('Saved as Weekend-trip.gpx')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Download GPX' }));
    expect(onDownload).toHaveBeenCalledExactlyOnceWith(route, 'Weekend-trip.gpx');
    expect(route.name).toBe('Forest walk');
  });

  it('blocks empty names and displays export errors while keeping the dialog open', async () => {
    const onDownload = vi.fn().mockImplementation(() => {
      throw new Error('Cannot export an empty GPX route.');
    });
    render(<ExportDialog route={route} onDownload={onDownload} onClose={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'File name' });
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Download GPX' })).toBeDisabled();
    fireEvent.submit(input.closest('form')!);
    expect(onDownload).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'route' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download GPX' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('Cannot export an empty GPX route.'),
    );
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('opens the guide and links to official help safely', async () => {
    const user = userEvent.setup();
    render(<ExportDialog route={route} onDownload={vi.fn()} onClose={vi.fn()} />);
    const summary = screen.getByText('How to import into Komoot');
    await user.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    const link = screen.getByRole('link', { name: 'Komoot import instructions' });
    expect(link).toHaveAttribute(
      'href',
      'https://support.komoot.com/hc/en-us/articles/10115477099674-Export-and-import-Routes-and-Activities',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.getByText(
        'Import the downloaded file yourself. Roamlet does not send routes to Komoot.',
      ),
    ).toBeVisible();
  });

  it('opens an independent Strava route guide with safe official help and no automatic transfer', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<ExportDialog route={route} onDownload={onDownload} onClose={vi.fn()} />);
    const summary = screen.getByText('How to import into Strava');
    await user.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('How to import into Komoot').closest('details')).not.toHaveAttribute('open');
    const link = screen.getByRole('link', { name: 'Strava import instructions' });
    expect(link).toHaveAttribute('href', 'https://support.strava.com/en-us/articles/15402061-how-do-i-create-a-route-from-a-gpx-file');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Import the downloaded file yourself. Roamlet does not send routes to Strava.')).toBeVisible();
    expect(screen.getByText('These steps create a route, not a recorded activity. Strava may require a subscription for route creation.')).toBeVisible();
    expect(onDownload).not.toHaveBeenCalled();
  });

  it('supports Escape and restores focus to the trigger', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <button>Export</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Export' });
    trigger.focus();
    rerender(
      <>
        <button>Export</button>
        <ExportDialog route={route} onDownload={vi.fn()} onClose={onClose} />
      </>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    rerender(
      <>
        <button>Export</button>
      </>,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('localizes the dialog and filename hint in Russian', async () => {
    await i18n.changeLanguage('ru');
    render(
      <ExportDialog
        route={{ ...route, name: 'Лесная прогулка' }}
        onDownload={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Экспорт маршрута' });
    expect(within(dialog).getByRole('textbox', { name: 'Имя файла' })).toHaveValue(
      'Лесная прогулка.gpx',
    );
    expect(within(dialog).getByText('Будет сохранён как Лесная прогулка.gpx')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Скачать GPX' })).toBeEnabled();
    expect(within(dialog).getByText('Как импортировать в Komoot')).toBeVisible();
    expect(within(dialog).getByText('Как импортировать в Strava')).toBeVisible();
    const details = within(dialog).getByRole('region', { name: 'Данные маршрута' });
    expect(within(details).getByText('Точки трека', { selector: 'dt' }).nextElementSibling).toHaveTextContent('2');
    expect(within(details).getByText('12,4 км')).toBeVisible();
  });
});
