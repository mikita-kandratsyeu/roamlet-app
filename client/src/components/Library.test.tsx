import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Toaster } from './ui/sonner';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Dialog } from './Dialog';
import { RouteComparison } from './RouteComparison';
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
  expect(
    screen.getByText(
      i18next.t(
        'Keep a downloaded JSON backup outside this browser so you can restore your library on another device.',
      ),
    ),
  ).toBeVisible();
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
  vi.mocked(listRoutes).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectLoad = reject;
      }),
  );
  render(<Library onClose={() => {}} onOpen={() => {}} />);
  expect(
    await screen.findByRole('status', { name: i18next.t('Opening your library…') }),
  ).toBeInTheDocument();
  const loader = screen.getByTestId('global-map-loader');
  expect(loader).toHaveAttribute('data-purpose', 'library');
  expect(loader.closest('[data-testid="panel-loader"]')).not.toBeNull();
  expect(loader.querySelector('.global-map-loader__orbit')).toBeInTheDocument();
  expect(document.querySelector('.library-loading')).toBeNull();
  rejectLoad(new Error('Your library could not be loaded.'));
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
  expect((await screen.findByText('Imported 2 routes; skipped 0.')).closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'success');
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

it('explains local-only storage and the scope of a library backup beside the actions', async () => {
  render(<Library onClose={vi.fn()} onOpen={vi.fn()} />);
  const group = await screen.findByRole('group', { name: 'Library backup' });
  expect(group).toHaveAccessibleDescription(
    'Routes stay only in this browser. No cloud copy. Clearing browser data deletes them. JSON backs up all saved routes, not settings or the current draft. GPX exports an individual route for other apps.',
  );
  expect(within(group).getByRole('button', { name: 'Download backup' })).toBeEnabled();
  expect(within(group).getByRole('button', { name: 'Restore from backup' })).toBeEnabled();
});

it('keeps comparison optional for existing library consumers', async () => {
  await openLibrary();
  expect(screen.queryByRole('checkbox', { name: /for comparison/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Compare routes' })).not.toBeInTheDocument();
});

it('selects 2–3 routes using keyboard-accessible checkboxes and enforces the maximum', async () => {
  const user = userEvent.setup();
  const third = route('c', 'River path', 3000, alpine.updatedAt);
  const fourth = route('d', 'Coastal path', 4000, alpine.updatedAt);
  vi.mocked(listRoutes).mockResolvedValue([alpine, woodland, third, fourth]);
  const onCompare = vi.fn();
  const { onOpen } = await openLibrary(onCompare);
  const compare = screen.getByRole('button', { name: 'Compare routes' });
  expect(compare).toBeDisabled();
  const select = (name: string) =>
    screen.getByRole('checkbox', { name: `Select ${name} for comparison` });
  select(alpine.name).focus();
  await user.keyboard(' ');
  expect(select(alpine.name)).toBeChecked();
  expect(compare).toBeDisabled();
  await user.click(select(woodland.name));
  expect(compare).toBeEnabled();
  await user.click(select(third.name));
  expect(select(fourth.name)).toBeDisabled();
  expect(select(alpine.name)).toBeEnabled();
  await user.click(compare);
  expect(onCompare).toHaveBeenCalledWith([alpine, woodland, third]);
  expect(onOpen).not.toHaveBeenCalled();
  expect(saveRoute).not.toHaveBeenCalled();
  expect(select(alpine.name)).toBeChecked();
  await user.click(select(woodland.name));
  expect(select(fourth.name)).toBeEnabled();
  await user.click(select(third.name));
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
  fireEvent.click(screen.getByRole('button', { name: 'Remove Woodland walk from comparison' }));
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
