import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import App from './App';
import { routeDb } from './domain/storage';
import * as storage from './domain/storage';
import { checkRoutingConfiguration } from './services/routing';
import i18n, { detectLanguage, LANGUAGE_KEY } from './i18n';
const provider = vi.hoisted(() => ({ calculateRoute: vi.fn(), calculateAlternatives: vi.fn() }));
vi.mock('./services/routing', () => ({
  checkRoutingConfiguration: vi.fn().mockResolvedValue(true),
  routingProvider: provider,
}));
vi.mock('./components/RouteMap', () => ({
  RouteMap: ({
    segments,
    manualDrawing,
    onToggleManualDrawing,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onMove,
    waypoints,
  }: {
    segments: unknown[];
    manualDrawing?: boolean;
    onToggleManualDrawing?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onMove: (id: string, coordinate: [number, number]) => void;
    waypoints: { id: string }[];
  }) => (
    <div
      data-testid="map"
      data-segments={segments.length}
      data-manual={manualDrawing}
      data-geometry={JSON.stringify(segments)}
    >
      Map
      <button aria-pressed={manualDrawing} onClick={onToggleManualDrawing}>
        Manual drawing
      </button>
      <button disabled={!onUndo || canUndo === false} onClick={onUndo}>
        Undo
      </button>
      <button disabled={!onRedo || canRedo === false} onClick={onRedo}>
        Redo
      </button>
      <button disabled={!waypoints.length} onClick={() => onMove(waypoints[0].id, [11.5, 47.3])}>
        Move first map point
      </button>
    </div>
  ),
}));
const geometry = [
  [11.4, 47.26, 600],
  [11.405, 47.265, 630],
  [11.41, 47.27, 615],
];
beforeEach(async () => {
  cleanup();
  await routeDb.routes.clear();
  await routeDb.table('drafts').clear();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  vi.clearAllMocks();
  vi.mocked(checkRoutingConfiguration).mockResolvedValue(true);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  provider.calculateRoute.mockResolvedValue({
    segments: [geometry],
    stats: { distance: 1342, duration: 480, ascent: 30, descent: 15 },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /^(Menu|Меню)$/ }), { key: 'ArrowDown' });
}
function selectLanguage(label: string) {
  openMenu();
  fireEvent.click(screen.getByRole('menuitemradio', { name: label }));
}
function addCoordinate(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Latitude, longitude' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add coordinates' }));
}
async function plan() {
  addCoordinate('47.26, 11.4');
  addCoordinate('47.27, 11.41');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
}
describe('route planner interactions', () => {
  it('shows exact missing-key guidance and hosted ORS setup without requiring a key for the map', async () => {
    vi.mocked(checkRoutingConfiguration).mockResolvedValue(false);
    render(<App />);
    expect(
      await screen.findByText(
        'Configure an OpenRouteService API key in VITE_ORS_API_KEY. GPX and saved routes remain available.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Setup help' }));
    const help = screen.getByRole('dialog');
    expect(within(help).getAllByRole('link', { name: 'OpenRouteService' })[0]).toHaveAttribute(
      'href',
      'https://account.heigit.org/signup',
    );
    expect(help).toHaveTextContent('VITE_ORS_API_KEY');
    expect(help).toHaveTextContent('visible in the browser and built assets');
    expect(help).toHaveTextContent('server proxy');
  });
  it.each([
    [
      'The routing request was rejected. Check the OpenRouteService API key and account permissions.',
      'Запрос маршрута отклонён. Проверьте API-ключ OpenRouteService и права аккаунта.',
    ],
    [
      'The routing request exceeds the service limits. Try fewer points or a shorter route.',
      'Запрос маршрута превышает ограничения сервиса. Попробуйте меньше точек или более короткий маршрут.',
    ],
  ])('localizes actionable ORS error: %s', async (message, russian) => {
    provider.calculateRoute.mockRejectedValueOnce(new Error(message));
    render(<App />);
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    selectLanguage('Русский');
    expect(screen.getByRole('alert')).toHaveTextContent(russian);
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
  });
  it('draws, moves, reverses and undoes manual segments without Directions or a token', async () => {
    vi.mocked(checkRoutingConfiguration).mockResolvedValue(false);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(screen.getByRole('button', { name: 'Manual drawing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.4, 47.26],
          [11.41, 47.27],
        ],
      ]),
    );
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    expect(screen.queryByText('VITE_ORS_API_KEY')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move first map point' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.5, 47.3],
          [11.41, 47.27],
        ],
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.41, 47.27],
          [11.5, 47.3],
        ],
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.5, 47.3],
          [11.41, 47.27],
        ],
      ]),
    );
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.41, 47.27],
          [11.5, 47.3],
        ],
      ]),
    );
    addCoordinate('47.28, 11.42');
    fireEvent.click(screen.getByRole('radio', { name: 'Hiking' }));
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    expect(provider.calculateAlternatives).not.toHaveBeenCalled();
  });

  it('saves and reopens manual routes for editing without converting them to provider routes', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Hand drawn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await routeDb.routes.toArray())[0].source).toBe('manual');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    fireEvent.click(await screen.findByRole('button', { name: /Hand drawn Cycling/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hiking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit waypoints' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manual drawing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    addCoordinate('47.28, 11.42');
    expect(JSON.parse(screen.getByTestId('map').getAttribute('data-geometry')!)[0]).toHaveLength(3);
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });

  it('requires confirmation before replacing manual geometry with automatic routing', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Switch to automatic routing?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch mode' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(1));
    expect(provider.calculateRoute.mock.calls[0][0]).toHaveLength(2);
  });

  it('ignores a late Directions response after switching to manual drawing', async () => {
    let resolve!: (value: {
      segments: number[][][];
      stats: { distance: number; duration: number };
    }) => void;
    provider.calculateRoute.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<App />);
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch mode' }));
    await act(async () =>
      resolve({ segments: [geometry], stats: { distance: 999, duration: 100 } }),
    );
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.4, 47.26],
          [11.41, 47.27],
        ],
      ]),
    );
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
  });

  it('confirms loop conversion, keeps its stops and restores the previous automatic mode', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    provider.calculateAlternatives.mockResolvedValueOnce([
      {
        segments: [
          [
            [11.4, 47.26],
            [11.41, 47.27],
            [11.42, 47.28],
            [11.43, 47.27],
            [11.4, 47.26],
          ],
        ],
        stats: { distance: 5000, duration: 1000 },
      },
    ]);
    render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: 'Round trip' }));
    addCoordinate('47.26, 11.4');
    fireEvent.click(screen.getByRole('button', { name: 'Find round trips' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Switch to manual drawing?');
    fireEvent.click(screen.getByRole('button', { name: 'Switch mode' }));
    expect(JSON.parse(screen.getByTestId('map').getAttribute('data-geometry')!)[0]).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Only your starting point will be kept');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to round trip' }));
    expect(screen.getByRole('radio', { name: 'Round trip' })).toHaveAttribute('data-state', 'on');
    expect(screen.getByRole('button', { name: 'Manual drawing' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    expect(provider.calculateAlternatives).toHaveBeenCalledTimes(1);
  });

  it('supports more than 25 manual points without silently dropping them in automatic mode', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    for (let i = 0; i < 26; i++) addCoordinate(`47.${2600 + i}, 11.4`);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Automatic routing supports up to 25');
    expect(screen.getByRole('button', { name: 'Manual drawing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(JSON.parse(screen.getByTestId('map').getAttribute('data-geometry')!)[0]).toHaveLength(
      26,
    );
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });
  it('focuses form fields and safe actions, and restores focus after editing or deleting a route', async () => {
    render(<App />);
    await plan();
    const save = screen.getByRole('button', { name: 'Save route' });
    save.focus();
    fireEvent.click(save);
    expect(screen.getByRole('textbox', { name: 'Route name' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(save).toHaveFocus());
    fireEvent.click(save);
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Focus trip' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus(),
    );
    const edit = await screen.findByRole('button', { name: 'Edit Focus trip' });
    fireEvent.click(edit);
    expect(screen.getByRole('textbox', { name: 'Route name' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(edit).toHaveFocus();
    const remove = screen.getByRole('button', { name: 'Delete Focus trip' });
    fireEvent.click(remove);
    expect(screen.getByRole('button', { name: 'Keep route' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Keep route' }));
    expect(remove).toHaveFocus();
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete Focus trip' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus(),
    );
  });
  it('switches to Russian persistently without recalculating routes or changing user names', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'River escape' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Description/ }), {
      target: { value: 'My own note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    selectLanguage('Русский');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить маршрут' }));
    expect(document.documentElement.lang).toBe('ru');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('ru');
    expect(detectLanguage()).toBe('ru');
    expect(screen.getByRole('textbox', { name: 'Название маршрута' })).toHaveValue('River escape');
    expect(screen.getByRole('textbox', { name: /Описание/ })).toHaveValue('My own note');
    expect(screen.getAllByText('1,3 км').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в библиотеку' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Маршрут сохранён');
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
    cleanup();
    render(<App />);
    openMenu();
    expect(screen.getByRole('menuitemradio', { name: 'Русский' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Мои маршруты' }));
    expect(
      await screen.findByRole('button', { name: /River escape Велосипед/ }),
    ).toBeInTheDocument();
    const saved = await routeDb.routes.toArray();
    expect(saved[0].name).toBe('River escape');
    expect(saved[0].description).toBe('My own note');
  });
  it('updates an already displayed error and confirmation when the language changes', async () => {
    render(<App />);
    addCoordinate('999, 20');
    expect(screen.getByRole('alert')).toHaveTextContent('latitude');
    selectLanguage('Русский');
    expect(screen.getByRole('alert')).toHaveTextContent('широту');
    selectLanguage('English');
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    expect(screen.getByRole('dialog', { name: 'Закрыть этот маршрут?' })).toHaveTextContent(
      'Несохранённые изменения',
    );
    expect(screen.getByRole('button', { name: 'Сбросить изменения' })).toBeInTheDocument();
  });
  it('translates an open clear-stops confirmation and its destructive action', async () => {
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Clear stops' }));
    expect(screen.getByRole('dialog', { name: 'Clear all stops?' })).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    const dialog = screen.getByRole('dialog', { name: 'Удалить все точки?' });
    expect(dialog).toHaveTextContent(
      'Все точки и рассчитанный маршрут будут удалены. Сохранённые маршруты не затрагиваются.',
    );
    expect(within(dialog).getByRole('button', { name: 'Удалить все точки' })).toBeInTheDocument();
  });

  it('accepts only coordinates and never offers address search', () => {
    render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Latitude, longitude' }), {
      target: { value: 'Minsk' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add coordinates' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter coordinates as latitude, longitude.',
    );
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Search$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });
  it('starts with an actionable empty overview instead of unavailable metrics', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Save route' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Calculate route' })).toBeDisabled();
    expect(screen.getByText('Where shall we go?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a stop' })).toBeEnabled();
    expect(screen.getByText('Add two stops to see distance and time.')).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });
  it('retries a failed calculation without duplicate requests or stale export', async () => {
    provider.calculateRoute.mockRejectedValueOnce(new Error('Connection failed'));
    render(<App />);
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    await screen.findByText('Connection failed');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate route' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Calculating route…' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    expect(provider.calculateRoute).toHaveBeenCalledTimes(2);
  });
  it('reorders stops by dragging while retaining the keyboard alternative', async () => {
    render(<App />);
    await plan();
    const items = screen.getAllByRole('listitem');
    fireEvent.dragStart(items[0].querySelector('[draggable]')!, {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'move' },
    });
    fireEvent.drop(items[1]);
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    expect(provider.calculateRoute.mock.calls[1][0][0].coordinate).toEqual([11.41, 47.27]);
    expect(screen.getByRole('button', { name: 'Move stop 1 down' })).toBeEnabled();
  });
  it('confirms destructive routing mode changes and preserves stops on cancel', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('radio', { name: 'Round trip' }));
    expect(screen.getByRole('dialog', { name: 'Switch to a round trip?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Point to point' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Round trip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to round trip' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
  });
  it('plans, saves, opens its library and reopens a persistent route', async () => {
    render(<App />);
    await plan();
    expect((await screen.findAllByText('1.3 km')).length).toBeGreaterThan(0);
    expect(await screen.findByText('OpenRouteService')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'River escape' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const saved = (await routeDb.routes.toArray())[0];
    expect(saved.source).toBe('openrouteservice');
    expect(saved.segments).toEqual([geometry]);
    cleanup();
    render(<App />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    const open = await screen.findByRole('button', { name: /River escape Cycling/ });
    fireEvent.click(open);
    expect(screen.getByRole('heading', { name: 'River escape' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
  });
  it('recalculates reversed/removed waypoints and uses the hiking profile', async () => {
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    expect(provider.calculateRoute.mock.calls[1][0][0].coordinate).toEqual([11.41, 47.27]);
    fireEvent.click(screen.getByRole('radio', { name: 'Hiking' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(3));
    expect(provider.calculateRoute.mock.calls[2][1]).toBe('hiking');
    fireEvent.click(screen.getByRole('button', { name: 'Remove stop 2' }));
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
  });
  it('never leaves stale geometry exportable on failed recalculation', async () => {
    render(<App />);
    await plan();
    provider.calculateRoute.mockRejectedValueOnce(new Error('Routing quota reached.'));
    addCoordinate('47.28, 11.42');
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
    expect(screen.getByTestId('map')).toHaveAttribute('data-segments', '0');
  });
  it('validates coordinate bounds without calling a service', () => {
    render(<App />);
    addCoordinate('999, 20');
    expect(screen.getByRole('alert')).toHaveTextContent('latitude');
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });
  it('requires confirmation before discarding an unsaved route', async () => {
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Unsaved changes');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
  });
  it('edits, duplicates and confirms deletion in the local library', async () => {
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Sunday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sunday' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Monday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Monday' }));
    await waitFor(async () => expect(await routeDb.routes.count()).toBe(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete Monday' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Monday' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }));
    await waitFor(async () => expect(await routeDb.routes.count()).toBe(1));
  });
  it('keeps the editor mounted and inert behind the library screen, restores focus, and isolates history shortcuts', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    const map = screen.getByTestId('map'),
      geometryBefore = map.getAttribute('data-geometry');
    const libraryButton = screen.getByRole('button', { name: 'My routes' });
    libraryButton.focus();
    fireEvent.click(libraryButton);
    await waitFor(() => expect(document.querySelector('.library-screen')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Saved routes' })).toBeInTheDocument();
    expect(document.querySelector('.editor-screen')).toHaveAttribute('inert');
    expect(document.querySelector('.editor-screen')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('map')).toBe(map);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(map).toHaveAttribute('data-geometry', geometryBefore!);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to map' }));
    await waitFor(() => expect(libraryButton).toHaveFocus());
    expect(document.querySelector('.editor-screen')).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(map).toHaveAttribute('data-geometry', geometryBefore!);
  });
  it('undoes and redoes ready geometry without issuing a third request and ignores native text undo', async () => {
    render(<App />);
    await plan();
    const original = screen.getByTestId('map').getAttribute('data-geometry');
    provider.calculateRoute.mockResolvedValueOnce({
      segments: [
        [
          [11.4, 47.26],
          [11.42, 47.28],
        ],
      ],
      stats: { distance: 2000, duration: 500 },
    });
    addCoordinate('47.28, 11.42');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', original!);
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.4, 47.26],
          [11.42, 47.28],
        ],
      ]),
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Latitude, longitude' }), {
      key: 'z',
      ctrlKey: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(provider.calculateRoute).toHaveBeenCalledTimes(2);
  });
  it('stores and restores the unfinished editor and time parameters without routing', async () => {
    const { unmount } = render(<App />);
    await plan();
    fireEvent.change(screen.getByLabelText('Personal speed (km/h)'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Stops (minutes)'), { target: { value: '20' } });
    await waitFor(async () => expect(await routeDb.table('drafts').count()).toBe(1));
    unmount();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore draft' }));
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    expect(screen.getByLabelText('Personal speed (km/h)')).toHaveValue(12);
    expect(screen.getByLabelText('Stops (minutes)')).toHaveValue(20);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
  });
  it('warns about corrupt drafts without blocking the planner and deletes only drafts', async () => {
    await routeDb.table('drafts').put({ id: 'current', version: 999 });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('draft could not');
    expect(screen.getByRole('textbox', { name: 'Latitude, longitude' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(async () => expect(await routeDb.table('drafts').count()).toBe(0));
    expect(await routeDb.routes.count()).toBe(0);
  });
  it('does not delete new edits made while a library save is awaiting completion', async () => {
    let finish!: () => void;
    const save = vi.spyOn(storage, 'saveRoute').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Saving' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Latitude, longitude'), {
      target: { value: '47.28, 11.42' },
    });
    fireEvent.click(screen.getByLabelText('Add coordinates'));
    await act(async () => finish());
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await waitFor(async () =>
      expect((await routeDb.table('drafts').get('current'))?.snapshot.waypoints).toHaveLength(3),
    );
    expect(save.mock.calls[0][0].waypoints).toHaveLength(2);
  });
  it('keeps personal time changes separate from provider statistics and routing', async () => {
    render(<App />);
    await plan();
    fireEvent.change(screen.getByLabelText('Personal speed (km/h)'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Stops (minutes)'), { target: { value: '10' } });
    expect(await screen.findByText('Total time with stops')).toBeInTheDocument();
    expect(screen.getByText('Original time estimate')).toBeInTheDocument();
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Timed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(async () => expect(await routeDb.routes.count()).toBe(1));
    expect((await routeDb.routes.toArray())[0].stats.duration).toBe(480);
    await waitFor(async () => expect(await routeDb.table('drafts').count()).toBe(0));
  });
});
