import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PlannedRoute } from '../domain/types';
import { deleteRoute, duplicateRoute, listRoutes, saveRoute } from '../domain/storage';
import { Library } from './Library';

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
  vi.mocked(listRoutes).mockResolvedValue([alpine, woodland]);
  vi.mocked(saveRoute).mockResolvedValue(undefined);
  vi.mocked(deleteRoute).mockResolvedValue(undefined);
});
afterEach(cleanup);

async function openLibrary() {
  const onClose = vi.fn();
  const onOpen = vi.fn();
  render(<Library onClose={onClose} onOpen={onOpen} />);
  await screen.findByRole('button', { name: /Alpine loop Cycling/ });
  return { onClose, onOpen };
}
function routeNames() {
  return screen
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

it('keeps an empty library limited to the close button and search field without fake creation controls', async () => {
  vi.mocked(listRoutes).mockResolvedValue([]);
  render(<Library onClose={() => {}} onOpen={() => {}} />);
  await screen.findByText(i18next.t('Your next adventure belongs here'));
  expect(screen.queryByRole('button', { name: /Sort routes:/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Saved routes 0');
  const rectangles = vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
  const search = screen.getByRole('textbox', { name: 'Search saved routes' });
  const close = screen.getByRole('button', { name: 'Close dialog' });
  fireEvent.keyDown(search, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(search).toHaveFocus();
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
