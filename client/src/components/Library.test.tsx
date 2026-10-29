import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
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
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openLibrary() {
  const onClose = vi.fn();
  const onOpen = vi.fn();
  render(<Library onClose={onClose} onOpen={onOpen} />);
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
  expect(
    screen.getByText(
      i18next.t(
        'Your browser stores these routes in IndexedDB. Export important routes as GPX before clearing browser data.',
      ),
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Alpine loop Cycling.*8\.0 km/ }));
  expect(onOpen).toHaveBeenCalledWith(alpine);
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
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
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(routeNames()).toHaveLength(2);
});

it('offers backup import for an empty library without fake route creation controls', async () => {
  vi.mocked(listRoutes).mockResolvedValue([]);
  render(<Library onClose={() => {}} onOpen={() => {}} />);
  await screen.findByText(i18next.t('Your next adventure belongs here'));
  expect(screen.queryByRole('button', { name: /Sort routes:/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export library' })).toBeDisabled();
  expect(screen.getByLabelText('Import library file')).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Saved routes 0');
  const rectangles = vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
  const file = screen.getByRole('button', { name: 'Import library' });
  const close = screen.getByRole('button', { name: 'Close dialog' });
  file.focus();
  fireEvent.keyDown(file, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(screen.getByRole('button', { name: 'Import library' })).toHaveFocus();
  rectangles.mockRestore();
});

it('announces loading and allows retrying a failed load rather than claiming the library is empty', async () => {
  vi.mocked(listRoutes).mockRejectedValueOnce(new Error('Your library could not be loaded.'));
  render(<Library onClose={() => {}} onOpen={() => {}} />);
  expect(
    screen.getByRole('status', { name: i18next.t('Opening your library…') }),
  ).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByText(i18next.t('Your next adventure belongs here'))).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: /Alpine loop Cycling/ });
  expect(listRoutes).toHaveBeenCalledTimes(2);
});

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
  expect(screen.getByText('Updating your library…')).toHaveAttribute('role', 'status');
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
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Route name' })).toHaveFocus());
  expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
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
  await screen.findByText('Imported 2 routes; skipped 0.');
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
  fireEvent.click(screen.getByRole('button', { name: 'Export library' }));
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
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
  await user.click(screen.getByRole('button', { name: 'Import library' }));
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
