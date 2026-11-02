import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Toaster } from './ui/sonner';
import { toast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Dialog } from './Dialog';
import { RouteComparison } from './RouteComparison';
import i18next from 'i18next';
import { translateMessage } from '../i18n';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PlannedRoute } from '../domain/types';
import { deleteRoute, duplicateRoute, listRoutes, saveRoute } from '../domain/storage';
import { Library } from './Library';
import { exportBackup, importBackup } from '../domain/backup';
import { loadPreferences, savePreferences } from '../domain/preferences';
import { thumbnailPaths } from './routeThumbnail';

vi.mock('../domain/backup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domain/backup')>()),
  importBackup: vi.fn(),
}));

vi.mock('../domain/storage', () => ({
  listRoutes: vi.fn(),
  saveRoute: vi.fn(),
  deleteRoute: vi.fn(),
  duplicateRoute: vi.fn(),
}));

function route(id: string, name: string, distance: number, updatedAt: string): PlannedRoute {
  return {
    id,
    name,
    description: `${name} description`,
    activity: id === 'a' ? 'cycling' : 'hiking',
    segments: [],
    waypoints: [],
    stats: { distance, duration: 600 },
    createdAt: updatedAt,
    updatedAt,
    source: 'gpx',
  };
}
const alpine = route('a', 'Alpine loop', 8000, '2026-01-01T12:00:00Z');
const woodland = route('b', 'Woodland walk', 2000, '2026-02-01T12:00:00Z');

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(toast, 'promise');
  vi.spyOn(toast, 'success');
  vi.spyOn(toast, 'error');
  render(<Toaster />);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  vi.mocked(listRoutes).mockResolvedValue([alpine, woodland]);
  vi.mocked(saveRoute).mockResolvedValue(undefined);
  vi.mocked(deleteRoute).mockResolvedValue(undefined);
});
afterEach(() => {
  toast.dismiss();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openLibrary(onCompare?: (routes: PlannedRoute[]) => void) {
  const onClose = vi.fn();
  const onOpen = vi.fn();
  render(<Library onClose={onClose} onOpen={onOpen} onCompare={onCompare} />);
  await screen.findByRole('button', { name: /Alpine loop Cycling/ });
  return { onClose, onOpen };
}
function routeNames() {
  return within(screen.getByRole('list', { name: 'Saved routes' }))
    .getAllByRole('button', { name: /(?:Cycling|Hiking)/ })
    .map((button) => button.textContent);
}

it('loads with search focus, route count, activity and distance, and reopens the selected route', async () => {
  const { onOpen } = await openLibrary();
  expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Saved routes 2');
  expect(routeNames()[0]).toContain('Woodland walk');
  const savedRoutes = screen.getByRole('list', { name: 'Saved routes' });
  expect(within(savedRoutes).getAllByRole('listitem')).toHaveLength(2);
  expect(within(savedRoutes).getByRole('button', { name: 'Edit Alpine loop' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Alpine loop Cycling.*8\.0 km/ }));
  expect(onOpen).toHaveBeenCalledWith(alpine);
  expect(screen.getByRole('region', { name: 'Saved routes' })).toHaveAccessibleDescription(
    i18next.t('Good routes are worth keeping. Saved on this device, no account needed.'),
  );
});

it('sorts by name and shortest distance using accessible radio menu items', async () => {
  const user = userEvent.setup();
  await openLibrary();
  await user.click(screen.getByRole('button', { name: /Sort routes:/ }));
  expect(screen.getByRole('menuitemradio', { name: 'Most recently updated' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await user.click(screen.getByRole('menuitemradio', { name: 'Name (A–Z)' }));
  expect(routeNames()[0]).toContain('Alpine loop');
  await user.click(screen.getByRole('button', { name: /Sort routes:/ }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Distance (shortest first)' }));
  expect(routeNames()[0]).toContain('Woodland walk');
});

it('dismisses the sort menu with Escape before closing the library on the next Escape', async () => {
  const user = userEvent.setup();
  const { onClose } = await openLibrary();
  await user.click(screen.getByRole('button', { name: /Sort routes:/ }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Sort routes:/ })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('searches names and descriptions, displays matches and clears no-match search with focus restored', async () => {
  await openLibrary();
  const search = screen.getByRole('textbox', { name: 'Search saved routes' });
  fireEvent.change(search, { target: { value: '  LOOP DESCRIPTION  ' } });
  expect(screen.getByRole('status')).toHaveTextContent('1 matching routes');
  expect(routeNames()).toHaveLength(1);
  fireEvent.change(search, { target: { value: 'nowhere' } });
  expect(screen.getByText(i18next.t('No routes match your search.'))).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reset search and filters' }));
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(routeNames()).toHaveLength(2);
});

it('offers backup import for an empty library without fake route creation controls', async () => {
  vi.mocked(listRoutes).mockResolvedValue([]);
  render(<Library onClose={() => {}} onOpen={() => {}} />);
  await screen.findByText(i18next.t('Your next adventure belongs here'));
  expect(screen.queryByRole('button', { name: /Sort routes:/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download backup' })).toBeDisabled();
  expect(screen.getByLabelText('Import library file')).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Saved routes 0');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back to map' })).toBeEnabled();
});

it('announces loading and allows retrying a failed load rather than claiming the library is empty', async () => {
  let rejectLoad!: (error: Error) => void;
  let finishRetry!: (routes: PlannedRoute[]) => void;
  vi.mocked(listRoutes)
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectLoad = reject;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRetry = resolve;
        }),
    );
  render(<Library onClose={() => {}} onOpen={() => {}} />);
  expect(
    await screen.findByRole('status', { name: i18next.t('Opening your library…') }),
  ).toBeInTheDocument();
  const skeleton = screen.getByTestId('library-skeleton');
  expect(skeleton.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
  expect(skeleton.querySelector('.library-skeleton-list')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back to map' })).toBeEnabled();
  rejectLoad(new Error('Your library could not be loaded.'));
  await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByText(i18next.t('Your next adventure belongs here'))).not.toBeInTheDocument();
  expect(screen.queryByTestId('library-skeleton')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByTestId('library-skeleton')).toBeVisible();
  await act(async () => {
    finishRetry([alpine, woodland]);
  });
  await screen.findByRole('button', { name: /Alpine loop Cycling/ });
  expect(screen.queryByTestId('library-skeleton')).not.toBeInTheDocument();
  expect(listRoutes).toHaveBeenCalledTimes(2);
});

it.each(['en', 'ru'])(
  'shows a local accessible skeleton while reading routes in %s and focuses search on completion',
  async (language) => {
    let finishLoad!: (routes: PlannedRoute[]) => void;
    vi.mocked(listRoutes).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    );
    const overflow = document.body.style.overflow;
    const view = render(<Library onClose={vi.fn()} onOpen={vi.fn()} />);
    await act(async () => {
      await i18next.changeLanguage(language);
    });
    const status = screen.getByRole('status', { name: i18next.t('Opening your library…') });
    expect(status).toHaveTextContent(i18next.t('Reading routes saved in this browser.'));
    const shapes = status.querySelector('.library-skeleton-list')!;
    expect(shapes).toHaveAttribute('aria-hidden', 'true');
    expect(shapes.querySelectorAll('.library-skeleton-card')).toHaveLength(4);
    expect(shapes.querySelector('button, a, input, [tabindex]')).toBeNull();
    expect(screen.queryByRole('list', { name: i18next.t('Saved routes') })).not.toBeInTheDocument();
    expect(
      screen.queryByText(i18next.t('Your next adventure belongs here')),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18next.t('Back to map') })).toBeEnabled();
    expect(view.container.inert).not.toBe(true);
    expect(document.body.style.overflow).toBe(overflow);
    await act(async () => {
      finishLoad([alpine]);
    });
    expect(screen.queryByTestId('library-skeleton')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: i18next.t('Search saved routes') })).toHaveFocus();
    expect(screen.getByRole('list', { name: i18next.t('Saved routes') })).toHaveTextContent(
      'Alpine loop',
    );
    await act(async () => {
      await i18next.changeLanguage('en');
    });
  },
);

it.each(['resolve', 'reject'])(
  'allows leaving the library during loading and ignores a late %s',
  async (outcome) => {
    let finishLoad!: (routes: PlannedRoute[]) => void;
    let failLoad!: (error: Error) => void;
    vi.mocked(listRoutes).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finishLoad = resolve;
          failLoad = reject;
        }),
    );
    function Screen() {
      const [open, setOpen] = useState(true);
      return open ? (
        <Library onClose={() => setOpen(false)} onOpen={vi.fn()} />
      ) : (
        <p>Map restored</p>
      );
    }
    render(<Screen />);
    const back = screen.getByRole('button', { name: 'Back to map' });
    expect(back).toHaveFocus();
    if (outcome === 'resolve') fireEvent.click(back);
    else fireEvent.keyDown(back, { key: 'Escape' });
    expect(screen.getByText('Map restored')).toBeVisible();
    await act(async () => {
      if (outcome === 'resolve') finishLoad([alpine]);
      else failLoad(new Error('Your library could not be loaded.'));
    });
    expect(screen.queryByTestId('library-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  },
);

it('edits trimmed details, exposes busy state and returns focus to the edit action', async () => {
  await openLibrary();
  const trigger = screen.getByRole('button', { name: 'Edit Alpine loop' });
  fireEvent.click(trigger);
  const name = screen.getByRole('textbox', { name: 'Route name' });
  expect(name).toHaveFocus();
  fireEvent.change(name, { target: { value: ' Updated loop ' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
    target: { value: ' New details ' },
  });
  let finish!: () => void;
  vi.mocked(saveRoute).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(
    (await screen.findByText('Updating your library…')).closest('[data-sonner-toast]'),
  ).toHaveAttribute('data-type', 'loading');
  expect(document.querySelector('.library-progress')).toBeNull();
  expect(name).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(saveRoute).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'a', name: 'Updated loop', description: 'New details' }),
  );
  finish();
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Route name' })).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('does not save a blank route name and keeps the labeled editor available', async () => {
  await openLibrary();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alpine loop' }));
  const editor = screen.getByRole('form', { name: 'Edit route details' });
  fireEvent.change(within(editor).getByRole('textbox', { name: 'Route name' }), {
    target: { value: '   ' },
  });
  expect(within(editor).getByRole('button', { name: 'Save changes' })).toBeDisabled();
  fireEvent.submit(editor);
  expect(saveRoute).not.toHaveBeenCalled();
  expect(editor).toBeVisible();
});

it('cancels editing without saving and restores the initiating action focus', async () => {
  await openLibrary();
  const trigger = screen.getByRole('button', { name: 'Edit Alpine loop' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(saveRoute).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
});

it('duplicates using the existing storage capability and restores its action focus', async () => {
  await openLibrary();
  const trigger = screen.getByRole('button', { name: 'Duplicate Alpine loop' });
  vi.mocked(duplicateRoute).mockResolvedValue({ ...alpine, id: 'copy' });
  fireEvent.click(trigger);
  await waitFor(() => expect(trigger).not.toBeDisabled());
  expect(duplicateRoute).toHaveBeenCalledWith(alpine);
  expect(listRoutes).toHaveBeenCalledTimes(2);
  expect(trigger).toHaveFocus();
});

it('focuses the safe deletion choice, keeps or deletes explicitly and falls back to search after removal', async () => {
  await openLibrary();
  const trigger = screen.getByRole('button', { name: 'Delete Alpine loop' });
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: 'Keep route' })).toHaveFocus();
  const confirmation = screen.getByRole('alert');
  expect(confirmation).toHaveAccessibleName('Delete route');
  expect(confirmation).toHaveTextContent('This cannot be undone.');
  fireEvent.click(screen.getByRole('button', { name: 'Keep route' }));
  expect(deleteRoute).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  vi.mocked(listRoutes).mockResolvedValue([woodland]);
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Delete route' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Delete Alpine loop' })).not.toBeInTheDocument(),
  );
  expect(deleteRoute).toHaveBeenCalledWith('a');
  expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus();
});

it('keeps failed edits available with an error and returns focus to the name field', async () => {
  await openLibrary();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alpine loop' }));
  vi.mocked(saveRoute).mockRejectedValue(new Error('Could not update your library.'));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  const message = translateMessage('Could not update your library.');
  await waitFor(() =>
    expect(document.querySelector('[data-sonner-toast][data-type="error"]')).toHaveTextContent(message),
  );
  expect(screen.getByRole('dialog')).not.toHaveTextContent(message);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Route name' })).toHaveFocus());
  expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
});

it('names the filter widget and length group and disables reset only when every filter and sort are empty', async () => {
  const user = userEvent.setup();
  await openLibrary();
  const filters = screen.getByRole('region', { name: 'Filter routes' });
  expect(within(filters).getByRole('heading', { level: 2, name: 'Filter routes' })).toBeVisible();
  const length = within(filters).getByRole('group', { name: 'Route length (km)' });
  expect(within(length).getByRole('spinbutton', { name: 'Minimum length (km)' })).toHaveValue(null);
  expect(within(length).getByRole('spinbutton', { name: 'Maximum length (km)' })).toHaveValue(null);
  const reset = within(filters).getByRole('button', { name: 'Reset filters' });
  expect(reset).toBeDisabled();
  expect(within(filters).getByRole('button', { name: 'Favorites only' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await user.click(screen.getByRole('button', { name: /Sort routes:/ }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Name (A–Z)' }));
  expect(reset).toBeEnabled();
  await user.click(reset);
  expect(reset).toBeDisabled();
  expect(loadPreferences().library.sort).toBe('updated');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search saved routes' }), {
    target: { value: 'no matching route' },
  });
  expect(reset).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Reset search and filters' })).toBeEnabled();
  await user.click(reset);
  expect(reset).toBeDisabled();
  expect(routeNames()).toHaveLength(2);
});

it('combines activity, favorite, tag, distance, search and sort filters and resets every filter', async () => {
  const user = userEvent.setup();
  vi.mocked(listRoutes).mockResolvedValue([
    { ...alpine, favorite: true, tags: ['mountain'] },
    { ...woodland, tags: ['forest'] },
  ]);
  await openLibrary();
  await user.click(screen.getByRole('button', { name: 'Activity' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Cycling' }));
  fireEvent.click(screen.getByRole('button', { name: 'Favorites only' }));
  await user.click(screen.getByRole('button', { name: 'Filter by tag' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'mountain' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Minimum length (km)' }), {
    target: { value: '7' },
  });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Maximum length (km)' }), {
    target: { value: '9' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search saved routes' }), {
    target: { value: 'mountain' },
  });
  expect(routeNames()).toHaveLength(1);
  expect(routeNames()[0]).toContain('Alpine');
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Maximum length (km)' }), {
    target: { value: '3' },
  });
  expect(screen.getByText(i18next.t('No routes match your search.'))).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(routeNames()).toHaveLength(2);
  expect(loadPreferences().library).toEqual({
    sort: 'updated',
    query: '',
    activity: 'all',
    favoriteOnly: false,
    tag: '',
    minKm: '',
    maxKm: '',
  });
});

it('loads library filters lazily from preferences and persists changes across reopening', async () => {
  savePreferences({
    library: {
      sort: 'name',
      query: 'Alpine',
      activity: 'all',
      favoriteOnly: false,
      tag: '',
      minKm: '',
      maxKm: '',
    },
  });
  render(<Library onClose={() => {}} onOpen={() => {}} />);
  await screen.findByRole('button', { name: /Alpine loop Cycling/ });
  expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveValue('Alpine');
  expect(routeNames()).toHaveLength(1);
  cleanup();
  render(<Library onClose={() => {}} onOpen={() => {}} />);
  await screen.findByRole('button', { name: /Alpine loop Cycling/ });
  expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveValue('Alpine');
});

it('edits favorite and trimmed deduplicated tags and toggles favorites without opening the editor', async () => {
  const { onOpen } = await openLibrary();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alpine loop' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Tags' }), {
    target: { value: ' forest, weekend, forest, ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Favorite' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Tags' })).not.toBeInTheDocument(),
  );
  expect(saveRoute).toHaveBeenCalledWith(
    expect.objectContaining({ favorite: true, tags: ['forest', 'weekend'] }),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Add to favorites' })[0]);
  await waitFor(() => expect(saveRoute).toHaveBeenCalledTimes(2));
  expect(onOpen).not.toHaveBeenCalled();
});

it('previews backup counts with safe copy default and imports only after confirmation without changing the editor', async () => {
  const { onOpen } = await openLibrary();
  vi.mocked(importBackup).mockResolvedValue({ imported: 2, skipped: 0, copied: 2, replaced: 0 });
  const file = new File([exportBackup([alpine, woodland])], 'library.json', {
    type: 'application/json',
  });
  fireEvent.change(screen.getByLabelText('Import library file'), { target: { files: [file] } });
  const preview = await screen.findByRole('region', { name: 'Library import preview' });
  expect(preview).toHaveTextContent('2 routes to import');
  expect(preview).toHaveTextContent('2 conflicting routes');
  expect(screen.getByRole('button', { name: 'Conflicting routes' })).toHaveTextContent(
    'Import copies',
  );
  expect(importBackup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Import routes' }));
  await waitFor(() =>
    expect(importBackup).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), 'copy'),
  );
  expect(
    (await screen.findByText(i18next.t('Imported {{count}} routes; skipped {{skipped}}.', {
      count: 2, skipped: 0,
    }))).closest('[data-sonner-toast]'),
  ).toHaveAttribute('data-type', 'success');
  expect(onOpen).not.toHaveBeenCalled();
});

it('allows choosing replacement, cancelling previews and reports malformed files without importing', async () => {
  const user = userEvent.setup();
  await openLibrary();
  const input = screen.getByLabelText('Import library file');
  fireEvent.change(input, {
    target: { files: [new File([exportBackup([alpine])], 'library.json')] },
  });
  await screen.findByRole('region', { name: 'Library import preview' });
  await user.click(screen.getByRole('button', { name: 'Conflicting routes' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Replace existing routes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
  expect(importBackup).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [new File(['{'], 'bad.json')] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid library backup JSON.');
  expect(screen.queryByRole('region', { name: 'Library import preview' })).not.toBeInTheDocument();
});

it('downloads a versioned JSON library export using a revoked local Blob URL', async () => {
  await openLibrary();
  const create = vi.fn(() => 'blob:library');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Download backup' }));
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
  expect(toast.promise).toHaveBeenCalledWith(expect.any(Promise), expect.objectContaining({
    loading: 'Preparing library backup…',
  }));
  expect(
    (await screen.findByText('Library backup download started.')).closest('[data-sonner-toast]'),
  ).toHaveAttribute('data-type', 'success');
  expect(toast.promise).toHaveBeenCalledOnce();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(listRoutes).toHaveBeenCalledOnce();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:library'));
  click.mockRestore();
  vi.unstubAllGlobals();
});

it('announces isolated invalid records while keeping the valid library available', async () => {
  vi.mocked(listRoutes).mockImplementation(async (onInvalid) => {
    onInvalid?.(2);
    return [alpine];
  });
  render(<Library onClose={() => {}} onOpen={() => {}} />);
  await screen.findByRole('button', { name: /Alpine loop Cycling/ });
  expect(screen.getByRole('alert')).toHaveTextContent(
    '2 invalid saved routes were hidden and retained on this device.',
  );
});

async function startPromiseAction(action: 'save' | 'delete' | 'duplicate' | 'import') {
  if (action === 'import') {
    fireEvent.change(screen.getByLabelText('Import library file'), {
      target: { files: [new File([exportBackup([alpine])], 'library.json')] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Import routes' }));
  } else if (action === 'duplicate') {
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Alpine loop' }));
  } else {
    fireEvent.click(screen.getByRole('button', {
      name: action === 'save' ? 'Edit Alpine loop' : 'Delete Alpine loop',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: action === 'save' ? 'Save changes' : 'Delete route',
    }));
  }
}

it.each([
  ['save', 'Route saved on this device. Your next adventure is ready.'],
  ['delete', 'Route deleted.'],
  ['duplicate', 'Route duplicated.'],
  ['import', 'Imported {{count}} routes; skipped {{skipped}}.'],
] as const)('keeps the %s promise loading and locked through refresh, with one success toast', async (action, success) => {
  const { onClose } = await openLibrary();
  vi.mocked(duplicateRoute).mockResolvedValue({ ...alpine, id: 'copy' });
  vi.mocked(importBackup).mockResolvedValue({ imported: 1, skipped: 0, copied: 1, replaced: 0 });
  let finishRefresh!: (routes: PlannedRoute[]) => void;
  vi.mocked(listRoutes).mockImplementationOnce(() => new Promise((resolve) => {
    finishRefresh = resolve;
  }));
  await startPromiseAction(action);
  const loading = await screen.findByText('Updating your library…');
  expect(loading.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'loading');
  await waitFor(() => expect(listRoutes).toHaveBeenCalledTimes(2));
  expect(document.querySelector('.library-progress')).toBeNull();
  expect(document.querySelector('.library-actions .animate-spin')).toBeNull();
  const dialog = screen.queryByRole('dialog');
  if (dialog) {
    const confirm = within(dialog).getByRole('button', {
      name: action === 'save' ? 'Save changes' : action === 'delete' ? 'Delete route' : 'Import routes',
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(dialog).toBeInTheDocument();
  } else {
    expect(screen.getByRole('button', { name: 'Back to map' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Alpine loop' }));
  }
  expect(onClose).not.toHaveBeenCalled();
  expect(toast.promise).toHaveBeenCalledOnce();
  finishRefresh([alpine, woodland]);
  const message = i18next.t(success, { count: 1, skipped: 0 });
  await waitFor(() => expect(screen.getByText(message).closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'success'));
  expect(screen.getAllByText(message)).toHaveLength(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it.each(['save', 'delete', 'duplicate', 'import'] as const)(
  'reports a rejected %s promise only in Sonner and preserves retry controls', async (action) => {
    await openLibrary();
    const error = new Error('Storage is unavailable');
    vi.mocked(saveRoute).mockRejectedValue(error);
    vi.mocked(deleteRoute).mockRejectedValue(error);
    vi.mocked(duplicateRoute).mockRejectedValue(error);
    vi.mocked(importBackup).mockRejectedValue(error);
    await startPromiseAction(action);
    await waitFor(() => expect(document.querySelector('[data-sonner-toast][data-type="error"]')).toHaveTextContent(error.message));
    expect(toast.promise).toHaveBeenCalledOnce();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(listRoutes).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[data-sonner-toast][data-type="error"]')).toHaveLength(1);
    const dialog = screen.queryByRole('dialog');
    if (action !== 'duplicate') {
      expect(dialog).not.toHaveTextContent(error.message);
      expect(screen.getAllByText(error.message)).toHaveLength(1);
      expect(within(dialog!).getByRole('button', {
        name: action === 'save' ? 'Save changes' : action === 'delete' ? 'Delete route' : 'Import routes',
      })).toBeEnabled();
    }
  },
);

it('reports a failed refresh as a promise error, without an import success or closing the preview', async () => {
  await openLibrary();
  vi.mocked(importBackup).mockResolvedValue({ imported: 1, skipped: 0, copied: 1, replaced: 0 });
  vi.mocked(listRoutes).mockRejectedValueOnce(new Error('Refresh failed'));
  await startPromiseAction('import');
  await waitFor(() => expect(document.querySelector('[data-sonner-toast][data-type="error"]')).toHaveTextContent('Refresh failed'));
  expect(screen.getByRole('dialog')).not.toHaveTextContent('Refresh failed');
  expect(screen.getAllByText('Refresh failed')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Cancel import' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Import routes' })).toBeEnabled();
  expect(screen.queryByText('Imported 1 routes; skipped 0.')).not.toBeInTheDocument();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it('reports export failures once and releases its lock without refreshing routes', async () => {
  await openLibrary();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    throw new Error('Download failed');
  });
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:failed-download'),
    revokeObjectURL: revoke,
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Download backup' }));
  await waitFor(() => expect(document.querySelector('[data-sonner-toast][data-type="error"]')).toHaveTextContent('Download failed'));
  expect(toast.promise).toHaveBeenCalledOnce();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Download backup' })).toBeEnabled();
  expect(listRoutes).toHaveBeenCalledOnce();
  expect(document.querySelector('a[download="roamlet-library.json"]')).toBeNull();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:failed-download'));
});

it('generates finite bounded local thumbnails with separate GPX segment paths', () => {
  const paths = thumbnailPaths([
    [
      [0, 0],
      [1, 1],
    ],
    [
      [9, 9],
      [10, 10],
    ],
  ]);
  expect(paths).toHaveLength(2);
  expect(paths.every((path) => path.startsWith('M') && !path.includes('NaN'))).toBe(true);
  expect(thumbnailPaths([])).toEqual([]);
  expect(thumbnailPaths([[[1, 1]]])[0]).not.toContain('Infinity');
  expect(
    thumbnailPaths([Array.from({ length: 100000 }, (_, i) => [i / 1000, 1])])[0].split(' '),
  ).toHaveLength(200);
});

it('uses a hidden file picker behind the styled Import library button and cohesive toggle controls', async () => {
  const user = userEvent.setup();
  await openLibrary();
  const input = screen.getByLabelText('Import library file');
  expect(input).toHaveAttribute('hidden');
  const pick = vi.spyOn(input as HTMLInputElement, 'click').mockImplementation(() => {});
  await user.click(screen.getByRole('button', { name: 'Restore from backup' }));
  expect(pick).toHaveBeenCalledOnce();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  const favorites = screen.getByRole('button', { name: 'Favorites only' });
  expect(favorites).toHaveAttribute('aria-pressed', 'false');
  await user.click(favorites);
  expect(favorites).toHaveAttribute('aria-pressed', 'true');
  await user.click(favorites);
  expect(favorites).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('region', { name: 'Filter routes' })).toHaveClass('library-filters');
});

it('keeps named keyboard-operated filter menus and groups the star with route actions', async () => {
  const user = userEvent.setup();
  await openLibrary();
  const activity = screen.getByRole('button', { name: 'Activity' });
  await user.click(activity);
  expect(screen.getByRole('menuitemradio', { name: 'All activities' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await user.keyboard('{Escape}');
  expect(activity).toHaveFocus();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  const actions = screen.getByRole('group', { name: 'Actions for Alpine loop' });
  expect(within(actions).getByRole('button', { name: 'Add to favorites' })).toHaveClass(
    'icon-button',
    'library-favorite-action',
  );
  expect(within(actions).getByRole('button', { name: 'Edit Alpine loop' })).toBeVisible();
});

it('renders a separate screen and overlays editing/deletion without placing dialogs in screen flow', async () => {
  const user = userEvent.setup();
  const { onClose } = await openLibrary();
  const libraryScreen = screen.getByRole('region', { name: 'Saved routes' });
  expect(libraryScreen).toHaveClass('library-screen');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const edit = screen.getByRole('button', { name: 'Edit Alpine loop' });
  await user.click(edit);
  const dialog = screen.getByRole('dialog', { name: 'Edit route details' });
  expect(libraryScreen.contains(dialog)).toBe(false);
  expect(within(dialog).getByRole('textbox', { name: 'Route name' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(edit).toHaveFocus());
  await user.click(screen.getByRole('button', { name: 'Delete Alpine loop' }));
  const deletion = screen.getByRole('dialog', { name: 'Delete route' });
  expect(libraryScreen.contains(deletion)).toBe(false);
  expect(within(deletion).getByRole('button', { name: 'Keep route' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
});

it('backs to the preserved map only without a child dialog and restores previous focus on unmount', async () => {
  const map = document.createElement('button');
  map.textContent = 'Map controls';
  document.body.append(map);
  map.focus();
  const onClose = vi.fn();
  const view = render(<Library onClose={onClose} onOpen={() => {}} />);
  try {
    await screen.findByRole('button', { name: /Alpine loop Cycling/ });
    expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    await waitFor(() => expect(map).toHaveFocus());
  } finally {
    map.remove();
  }
});

it('opens import preview in a separate dialog and Escape cancels preview rather than leaving the screen', async () => {
  const user = userEvent.setup();
  const { onClose } = await openLibrary();
  const libraryScreen = screen.getByRole('region', { name: 'Saved routes' });
  fireEvent.change(screen.getByLabelText('Import library file'), {
    target: { files: [new File([exportBackup([alpine])], 'library.json')] },
  });
  const preview = await screen.findByRole('dialog', { name: 'Library import preview' });
  expect(libraryScreen.contains(preview)).toBe(false);
  expect(within(preview).getByRole('button', { name: 'Cancel import' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(importBackup).not.toHaveBeenCalled();
});

it('renders three short tags as compact badges with complete accessible labels', async () => {
  const tags = ['234e234', '23423423423', '2'];
  vi.mocked(listRoutes).mockResolvedValue([{ ...alpine, tags }, woodland]);
  await openLibrary();
  const body = screen.getByRole('button', { name: /Alpine loop Cycling/ });
  const tagRow = body.querySelector('.library-route-tags')!;
  const badges = tagRow.querySelectorAll('[data-slot="badge"]');
  expect(badges).toHaveLength(3);
  for (const [index, badge] of Array.from(badges).entries()) {
    expect(badge).toHaveTextContent(tags[index]);
    expect(badge).toHaveAttribute('title', tags[index]);
    expect(badge).toHaveAttribute('data-variant', 'secondary');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  }
  expect(body).toHaveAccessibleName(expect.stringContaining(tags.join(', ')));
  expect(tagRow.querySelector('.library-route-tag-overflow')).toBeNull();
});

it('reserves an empty tag row without badges for absent and empty tags', async () => {
  vi.mocked(listRoutes).mockResolvedValue([alpine, { ...woodland, tags: [] }]);
  await openLibrary();
  const rows = screen
    .getByRole('list', { name: 'Saved routes' })
    .querySelectorAll('.library-route-tags');
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).toHaveTextContent(/^$/);
    expect(row.querySelector('[data-slot="badge"]')).toBeNull();
  }
});

it('keeps complete long route names/tags/details accessible in consistently reserved card content slots', async () => {
  const longName = `Alpine loop ${'(copy) '.repeat(35)}`;
  const longTags = [
    'mountains'.repeat(30),
    'weekend',
    'forest',
    'lake',
    'coast',
    'city',
    'trail',
    'hidden-tag',
  ];
  const longDescription = 'Very detailed route notes. '.repeat(80);
  const longRoute = { ...alpine, name: longName, tags: longTags, description: longDescription };
  vi.mocked(listRoutes).mockResolvedValue([longRoute, { ...woodland, description: '' }]);
  const onOpen = vi.fn();
  render(<Library onClose={() => {}} onOpen={onOpen} />);
  const list = await screen.findByRole('list', { name: 'Saved routes' });
  const bodies = within(list)
    .getAllByRole('button')
    .filter((button) => button.classList.contains('library-route-body'));
  expect(bodies).toHaveLength(2);
  const longBody = bodies.find((button) => button.title === longName)!;
  expect(longBody).toHaveAccessibleName(expect.stringContaining(longName));
  expect(longBody.querySelector('.library-route-title')).toHaveAttribute('title', longName);
  expect(longBody.querySelector('.library-route-title')).toHaveTextContent(longName.trim());
  expect(longBody.querySelector('.library-route-tags')).toHaveAttribute(
    'title',
    longTags.join(' · '),
  );
  const tagRow = longBody.querySelector('.library-route-tags')!;
  expect(tagRow.querySelectorAll('[data-slot="badge"]')).toHaveLength(4);
  expect(tagRow.querySelectorAll('.library-route-tag-label')).toHaveLength(3);
  expect(tagRow.querySelector('.library-route-tag-label')).toHaveTextContent(longTags[0]);
  expect(tagRow.querySelector('.library-route-tag-overflow')).toHaveTextContent('+5');
  expect(tagRow.querySelector('.library-route-tag-overflow')).toHaveAttribute(
    'title',
    longTags.slice(3).join(', '),
  );
  expect(longBody).toHaveAccessibleName(expect.stringContaining(longTags.join(', ')));
  expect(longBody.querySelector('.route-description')).toHaveAttribute('title', longDescription);
  for (const body of bodies) {
    expect(body.querySelector('.library-route-title')).toBeInTheDocument();
    expect(body.querySelector('.library-route-meta')).toBeInTheDocument();
    expect(body.querySelector('.library-route-tags')).toBeInTheDocument();
    expect(body.querySelector('.route-description')).toBeInTheDocument();
  }
  const card = longBody.closest('.library-route') as HTMLElement;
  const actions = within(card).getByRole('group');
  expect(
    within(actions).getByRole('button', { name: `Edit ${longName.trim()}` }),
  ).toHaveTextContent('Edit');
  expect(
    within(actions).getByRole('button', { name: `Duplicate ${longName.trim()}` }),
  ).toHaveTextContent('Copy');
  expect(within(actions).getByRole('button', { name: `Delete ${longName.trim()}` })).toHaveClass(
    'library-delete-action',
  );
  fireEvent.click(longBody);
  expect(onOpen).toHaveBeenCalledWith(longRoute);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search saved routes' }), {
    target: { value: 'hidden-tag' },
  });
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  fireEvent.click(within(actions).getByRole('button', { name: `Edit ${longName.trim()}` }));
  expect(screen.getByRole('textbox', { name: 'Tags' })).toHaveValue(longTags.join(', '));
});

it('keeps backup actions available while storage explanations are collapsed', async () => {
  const user = userEvent.setup();
  await openLibrary();
  const group = screen.getByRole('group', { name: 'Library backup' });
  const disclosure = group.querySelector('details') as HTMLDetailsElement;
  const summary = within(group).getByText('Library backup');
  expect(disclosure.open).toBe(false);
  expect(within(group).getByText(/Routes stay only in this browser/)).not.toBeVisible();
  await user.click(summary);
  expect(disclosure.open).toBe(true);
  expect(within(group).getByText(/Routes stay only in this browser/)).toBeVisible();
  await user.click(summary);
  expect(disclosure.open).toBe(false);
  expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveValue('');
  expect(
    within(screen.getByRole('list', { name: 'Saved routes' })).getAllByRole('listitem'),
  ).toHaveLength(2);
  expect(group).toHaveAccessibleDescription(
    'Routes stay only in this browser unless you create a backup. Connections offers optional encrypted cloud copies. Clearing browser data deletes local routes. JSON backs up all saved routes, not settings or the current draft. GPX exports an individual route for other apps.',
  );
  expect(within(group).getByRole('button', { name: 'Download backup' })).toBeEnabled();
  expect(within(group).getByRole('button', { name: 'Restore from backup' })).toBeEnabled();
});

it('keeps comparison optional for existing library consumers', async () => {
  await openLibrary();
  expect(screen.queryByRole('checkbox', { name: /for comparison/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Compare routes' })).not.toBeInTheDocument();
});

it('selects 2–5 routes using keyboard-accessible checkboxes and enforces the maximum', async () => {
  const user = userEvent.setup();
  const third = route('c', 'River path', 3000, alpine.updatedAt);
  const fourth = route('d', 'Coastal path', 4000, alpine.updatedAt);
  const fifth = route('e', 'Valley trail', 5000, alpine.updatedAt);
  const sixth = route('f', 'Ridge trail', 6000, alpine.updatedAt);
  vi.mocked(listRoutes).mockResolvedValue([alpine, woodland, third, fourth, fifth, sixth]);
  const onCompare = vi.fn();
  const { onOpen } = await openLibrary(onCompare);
  const compare = screen.getByRole('button', { name: 'Compare routes' });
  expect(screen.getByRole('heading', { name: 'Route comparison' })).toBeVisible();
  expect(screen.getByText('Choose 2–5 routes to compare on the map.')).toBeVisible();
  expect(compare).toBeDisabled();
  const select = (name: string) => screen.getByRole('checkbox', { name: `Select ${name} for comparison` });
  select(alpine.name).focus();
  await user.keyboard(' ');
  expect(select(alpine.name)).toBeChecked();
  expect(screen.getByText('1 route selected. Choose one more to compare.')).toBeVisible();
  expect(compare).toBeDisabled();
  await user.click(select(woodland.name));
  expect(screen.getByText('Ready to compare. You can select up to 5 routes.')).toBeVisible();
  expect(compare).toBeEnabled();
  for (const selected of [third, fourth, fifth]) await user.click(select(selected.name));
  expect(screen.getByText('Selection limit reached: 5 routes. Ready to compare.')).toBeVisible();
  expect(select(sixth.name)).toBeDisabled();
  expect(select(alpine.name)).toBeEnabled();
  await user.click(compare);
  expect(onCompare).toHaveBeenCalledWith([alpine, woodland, third, fourth, fifth]);
  expect(onOpen).not.toHaveBeenCalled();
  expect(saveRoute).not.toHaveBeenCalled();
  expect(select(alpine.name)).toBeChecked();
  await user.click(select(woodland.name));
  expect(select(sixth.name)).toBeEnabled();
  for (const selected of [third, fourth, fifth]) await user.click(select(selected.name));
  expect(compare).toBeDisabled();
});

it('retains hidden selections and filters on compare and allows removing hidden routes', async () => {
  const onCompare = vi.fn();
  await openLibrary(onCompare);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Woodland walk for comparison' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpine loop for comparison' }));
  const search = screen.getByRole('textbox', { name: 'Search saved routes' });
  fireEvent.change(search, { target: { value: 'nowhere' } });
  expect(screen.getByText(/Some selected routes are hidden by filters/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Compare routes' }));
  expect(onCompare).toHaveBeenCalledWith([woodland, alpine]);
  expect(search).toHaveValue('nowhere');
  expect(loadPreferences().library.query).toBe('nowhere');
  const remove = screen.getByRole('button', { name: 'Remove Woodland walk from comparison' });
  const icon = remove.querySelector('svg')!;
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(icon).toHaveClass('size-5');
  expect(remove.querySelector('.library-comparison-route-name')).toHaveTextContent('Woodland walk');
  fireEvent.click(icon);
  expect(screen.getByRole('button', { name: 'Compare routes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.queryByRole('list', { name: 'Selected routes' })).not.toBeInTheDocument();
  expect(search).toHaveValue('nowhere');
});

it('clears comparison on Escape before exiting while keeping route opening available', async () => {
  const { onClose, onOpen } = await openLibrary(vi.fn());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpine loop for comparison' }));
  fireEvent.keyDown(screen.getByRole('region', { name: 'Saved routes' }), { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole('checkbox', { name: 'Select Alpine loop for comparison' }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /Alpine loop Cycling/ }));
  expect(onOpen).toHaveBeenCalledWith(alpine);
  fireEvent.keyDown(screen.getByRole('region', { name: 'Saved routes' }), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
});

it('compares current saved edits and drops routes deleted after selection', async () => {
  const onCompare = vi.fn();
  await openLibrary(onCompare);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpine loop for comparison' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Woodland walk for comparison' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alpine loop' }));
  const updated = { ...alpine, name: 'Updated loop' };
  vi.mocked(listRoutes).mockResolvedValue([updated, woodland]);
  fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
    target: { value: updated.name },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Compare routes' }));
  expect(onCompare).toHaveBeenCalledWith([updated, woodland]);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Updated loop' }));
  vi.mocked(listRoutes).mockResolvedValue([woodland]);
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Delete route' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Compare routes' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Remove Updated loop from comparison' }),
  ).not.toBeInTheDocument();
});

it('preserves filters and selection and restores compare focus after a parent dialog closes', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  function Parent() {
    const [comparison, setComparison] = useState<PlannedRoute[] | null>(null);
    return (
      <>
        <Library onClose={onClose} onOpen={vi.fn()} onCompare={setComparison} />
        {comparison && (
          <Dialog title="Compare saved routes" wide onClose={() => setComparison(null)}>
            <RouteComparison routes={comparison} />
          </Dialog>
        )}
      </>
    );
  }
  render(<Parent />);
  await screen.findByRole('checkbox', { name: 'Select Alpine loop for comparison' });
  await user.click(screen.getByRole('checkbox', { name: 'Select Alpine loop for comparison' }));
  await user.click(screen.getByRole('checkbox', { name: 'Select Woodland walk for comparison' }));
  await user.type(screen.getByRole('textbox', { name: 'Search saved routes' }), 'Alpine');
  await user.click(screen.getByRole('button', { name: 'Compare routes' }));
  const dialog = screen.getByRole('dialog', { name: 'Compare saved routes' });
  expect(within(dialog).getByRole('table', { name: 'Saved route comparison' })).toBeVisible();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Compare routes' })).toHaveFocus();
  expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveValue('Alpine');
  expect(screen.getByRole('checkbox', { name: 'Select Alpine loop for comparison' })).toBeChecked();
  expect(
    within(screen.getByRole('list', { name: 'Selected routes' })).getAllByRole('listitem'),
  ).toHaveLength(2);
});
