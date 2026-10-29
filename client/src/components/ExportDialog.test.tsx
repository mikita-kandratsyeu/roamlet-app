import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportDialog } from './ExportDialog';
import type { PlannedRoute } from '../domain/types';
import i18n from '../i18n';

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

afterEach(() => cleanup());

describe('ExportDialog', () => {
  it('shows route details and a collapsed guide without downloading', () => {
    const onDownload = vi.fn();
    render(<ExportDialog route={route} onDownload={onDownload} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Export route' })).toBeVisible();
    expect(screen.getByText('Forest walk')).toBeVisible();
    expect(screen.getByText('12.4 km')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveValue('Forest walk.gpx');
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveFocus();
    expect(screen.getByText('How to import into Komoot').closest('details')).not.toHaveAttribute(
      'open',
    );
    expect(onDownload).not.toHaveBeenCalled();
  });

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

  it('blocks empty names and displays export errors while keeping the dialog open', () => {
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
    expect(screen.getByRole('alert')).toHaveTextContent(
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
  });
});
