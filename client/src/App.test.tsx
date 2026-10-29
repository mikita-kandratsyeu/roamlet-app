import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import App from './App';
import { routeDb } from './domain/storage';
import * as storage from './domain/storage';
import { checkRoutingConfiguration } from './services/routing';
import i18n, { detectLanguage, LANGUAGE_KEY } from './i18n';
const provider = vi.hoisted(() => ({
  calculateRoute: vi.fn(),
  calculateAlternatives: vi.fn(),
  calculatePointAlternatives: vi.fn(),
}));
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
    selectedWaypointId,
    onSelectWaypoint,
    onReplaceWaypoint,
    routeStale,
    directSegments,
    comparisonLayers,
    comparisonMode,
    highlightSegments,
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
    selectedWaypointId?: string | null;
    onSelectWaypoint?: (id: string) => void;
    onReplaceWaypoint?: (id: string) => void;
    routeStale?: boolean;
    directSegments?: unknown[];
    comparisonLayers?: unknown[];
    comparisonMode?: boolean;
    highlightSegments?: unknown[];
  }) => (
    <div
      data-testid="map"
      data-segments={segments.length}
      data-manual={manualDrawing}
      data-geometry={JSON.stringify(segments)}
      data-selected={selectedWaypointId ?? ''}
      data-stale={routeStale}
      data-direct={JSON.stringify(directSegments ?? [])}
      data-comparison={comparisonMode}
      data-comparison-layers={JSON.stringify(comparisonLayers ?? [])}
      data-highlight={JSON.stringify(highlightSegments ?? [])}
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
      <button disabled={!waypoints.length} onClick={() => onSelectWaypoint?.(waypoints[0].id)}>
        Select first map point
      </button>
      <button disabled={!waypoints.length} onClick={() => onReplaceWaypoint?.(waypoints[0].id)}>
        Replace first map point
      </button>
    </div>
  ),
}));
const geometry: [number, number, number][] = [
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
  vi.restoreAllMocks();
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
  fireEvent.change(screen.getByRole('textbox', { name: 'Latitude' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add coordinates' }));
}
function choosePlannerOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: label }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
}
async function plan() {
  addCoordinate('47.26, 11.4');
  addCoordinate('47.27, 11.41');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
}
function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => window.dispatchEvent(new Event(online ? 'online' : 'offline')));
}

describe('route preparation features', () => {
  it('compares saved routes without losing the current unsaved editor or making routing requests', async () => {
    const now = new Date().toISOString();
    await routeDb.routes.bulkAdd(
      ['Lake', 'Forest'].map((name, index) => ({
        id: `comparison-${index}`,
        name,
        description: '',
        activity: 'hiking' as const,
        segments: [geometry],
        waypoints: [],
        stats: { distance: 1342, duration: 1000 },
        source: 'gpx' as const,
        createdAt: now,
        updatedAt: now,
      })),
    );
    render(<App />);
    await plan();
    const editorMap = screen.getByTestId('map');
    const before = editorMap.getAttribute('data-geometry');
    const requests = provider.calculateRoute.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'My routes' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Lake for comparison' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Forest for comparison' }));
    const compare = screen.getByRole('button', { name: 'Compare routes' });
    compare.focus();
    fireEvent.click(compare);
    const dialog = screen.getByRole('dialog', { name: 'Compare saved routes' });
    expect(
      within(dialog).getByRole('table', { name: 'Saved route comparison' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId('map')).toHaveAttribute('data-comparison', 'true');
    expect(editorMap).toHaveAttribute('data-geometry', before!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(compare).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(screen.getByTestId('map')).toBe(editorMap);
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    expect(provider.calculateRoute).toHaveBeenCalledTimes(requests);
  });

  it('highlights imported climbs and clears the highlight when opening another route', async () => {
    render(<App />);
    const xml =
      '<gpx version="1.1"><metadata><name>Climb</name></metadata><trk><trkseg><trkpt lat="47.26" lon="11.4"><ele>100</ele></trkpt><trkpt lat="47.27" lon="11.41"><ele>150</ele></trkpt></trkseg></trk></gpx>';
    const file = Object.assign(new File([xml], 'climb.gpx', { type: 'application/gpx+xml' }), {
      text: async () => xml,
    });
    fireEvent.change(screen.getByLabelText('Import GPX file'), { target: { files: [file] } });
    const climb = await within(
      await screen.findByRole('region', { name: 'Climb analysis' }),
    ).findByRole('button', { name: /Climb 1/ });
    fireEvent.click(climb);
    expect(screen.getByTestId('map').getAttribute('data-highlight')).not.toBe('[]');
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByTestId('map')).toHaveAttribute('data-highlight', '[]');
  });
});

describe('route export', () => {
  it('opens the export dialog before downloading and keeps the original route name', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:test-export');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    await plan();
    const geometryBefore = screen.getByTestId('map').getAttribute('data-geometry');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = screen.getByRole('dialog', { name: 'Export route' });
    expect(createObjectURL).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'File name' }), {
      target: { value: 'Weekend/trip.gpx' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download GPX' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click.mock.instances[0]).toHaveAttribute('download', 'Weekend-trip.gpx');
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/gpx+xml');
    const xml = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(xml).toContain('<name>Untitled route</name>');
    expect(xml).not.toContain('Weekend');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('map').getAttribute('data-geometry')).toBe(geometryBefore);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-export'), {
      timeout: 1500,
    });
  });
});

describe('offline planner', () => {
  it('checks server routing availability only after an offline start reconnects', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<App />);
    expect(checkRoutingConfiguration).not.toHaveBeenCalled();
    setOnline(true);
    await waitFor(() => expect(checkRoutingConfiguration).toHaveBeenCalledOnce());
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });

  it('preserves calculated geometry and export, blocks online editing, and does not recalculate on reconnect', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    const original = screen.getByTestId('map').getAttribute('data-geometry');
    provider.calculateRoute.mockClear();
    setOnline(false);
    expect(screen.getByText('No internet connection')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update route' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Cycling' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move first map point' }));
    expect(screen.getByTestId('map').getAttribute('data-geometry')).toBe(original);
    setOnline(true);
    expect(screen.getByRole('button', { name: 'Update route' })).toBeEnabled();
    expect(screen.queryByText('No internet connection')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    expect(screen.getByTestId('map').getAttribute('data-geometry')).toBe(original);
  });

  it('cancels pending automatic routing when the connection is lost', async () => {
    await i18n.changeLanguage('en');
    provider.calculateRoute.mockImplementation(() => new Promise(() => {}));
    render(<App />);
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledOnce());
    const signal = provider.calculateRoute.mock.calls[0][2] as AbortSignal;
    setOnline(false);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Calculating route…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calculate route' })).toBeDisabled();
  });

  it('allows coordinate-based manual routes offline and hides online setup errors', async () => {
    await i18n.changeLanguage('en');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.mocked(checkRoutingConfiguration).mockResolvedValue(false);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Use manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toBeEnabled();
    expect(
      screen.getByText(/Enter coordinates to draw straight lines without an online map\./),
    ).toBeVisible();
    expect(document.querySelector('.configuration-note')).toBeNull();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });
});

describe('route planner interactions', () => {
  it('offers manual drawing in the empty planner and an explicit return without routing requests', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a route manually' }));
    expect(screen.getByRole('region', { name: 'Manual drawing' })).toBeVisible();
    expect(screen.queryByRole('radiogroup', { name: 'Route style' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to automatic routing' }));
    expect(screen.getByRole('radiogroup', { name: 'Route style' })).toBeVisible();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });

  it('explains offline limits and JSON backups before the connection is lost', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help and data sources' }));
    const help = screen.getByRole('dialog', { name: 'Help and data sources' });
    expect(within(help).getByText('Without an internet connection')).toBeVisible();
    expect(within(help).getByText(/Visit the app online first/)).toBeVisible();
    expect(within(help).getByText(/There is no cloud copy/)).toBeVisible();
    expect(within(help).getByText(/Internet required: loading the map/)).toBeVisible();
  });

  it('explains why returning to automatic routing is disabled offline', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a route manually' }));
    setOnline(false);
    const button = screen.getByRole('button', { name: 'Return to automatic routing' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Connect to the internet to calculate routes.');
    expect(document.querySelector('.offline-planner-notice')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toBeEnabled();
  });
  it.each(['en', 'ru'])(
    'shows product help and accurate data credits without deployment instructions (%s)',
    async (language) => {
      await i18n.changeLanguage(language);
      vi.mocked(checkRoutingConfiguration).mockResolvedValue(false);
      render(<App />);
      expect(
        await screen.findByText(
          i18n.t('Configure ORS_API_KEY on the server. GPX and saved routes remain available.'),
        ),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: i18n.t('Setup') }));
      const help = screen.getByRole('dialog');
      expect(within(help).getByRole('link', { name: 'OpenRouteService' })).toHaveAttribute(
        'href',
        'https://openrouteservice.org/',
      );
      expect(within(help).getByRole('link', { name: 'OpenFreeMap' })).toHaveAttribute(
        'href',
        'https://openfreemap.org/',
      );
      expect(within(help).getByRole('link', { name: 'OpenMapTiles' })).toHaveAttribute(
        'href',
        'https://openmaptiles.org/',
      );
      expect(within(help).getByRole('link', { name: 'ODbL' })).toHaveAttribute(
        'href',
        'https://opendatacommons.org/licenses/odbl/1-0/',
      );
      expect(help).not.toHaveTextContent(
        /ORS_API_KEY|Vercel|Firewall|cycling-regular|foot-hiking|18 km\/h|18 км\/ч/,
      );
      expect(within(help).queryByRole('link', { name: /signup/i })).not.toBeInTheDocument();
      expect(help).toHaveTextContent(i18n.t('Standard map: OpenStreetMap. Light map:'));
      expect(help).toHaveTextContent(i18n.t('Online requests and your data'));
      expect(help).toHaveTextContent(i18n.t('Planning routes'));
    },
  );
  it.each([
    [
      'The routing request was rejected. Check the OpenRouteService API key and account permissions.',
      'Не удалось выполнить автоматический расчёт. Попробуйте позже или нарисуйте маршрут вручную.',
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
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t(message));
    selectLanguage('Русский');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(russian));
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
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
    expect(screen.queryByText('ORS_API_KEY')).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
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

  it('replaces a stop through separate coordinate fields and clears them only after a valid change', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    fireEvent.click(screen.getByRole('button', { name: 'Replace stop 1' }));
    const latitude = screen.getByRole('textbox', { name: 'Latitude' });
    const longitude = screen.getByRole('textbox', { name: 'Longitude' });
    expect(latitude).toHaveFocus();
    fireEvent.change(latitude, { target: { value: '91' } });
    fireEvent.change(longitude, { target: { value: '11.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace stop coordinates' }));
    expect(latitude).toHaveValue('91');
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.4, 47.26],
          [11.41, 47.27],
        ],
      ]),
    );
    fireEvent.change(latitude, { target: { value: '47.3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace stop coordinates' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.5, 47.3],
          [11.41, 47.27],
        ],
      ]),
    );
    expect(latitude).toHaveValue('');
    expect(longitude).toHaveValue('');
    expect(latitude).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: 'Replace stop coordinates' }),
    ).not.toBeInTheDocument();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
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

  it('supports more than 25 manual points without silently dropping them in automatic mode', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    for (let i = 0; i < 26; i++) addCoordinate(`47.${2600 + i}, 11.4`);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Automatic routing supports up to 25',
    );
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
    expect(await screen.findByText(/Маршрут сохранён/)).toBeInTheDocument();
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
    expect(screen.getByRole('alert')).toHaveTextContent('Latitude must be between −90 and 90.');
    selectLanguage('Русский');
    expect(screen.getByRole('alert')).toHaveTextContent('Широта должна быть от −90 до 90.');
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Latitude' }), {
      target: { value: 'Minsk' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add coordinates' }));
    expect(screen.getByText('Enter a number, for example 47.26.')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Enter longitude.')).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toHaveFocus();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Search$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });
  it('starts with an actionable empty overview instead of unavailable metrics', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Save route' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    expect(provider.calculateRoute).toHaveBeenCalledTimes(2);
  });
  it('reorders stops by dragging while retaining the keyboard alternative', async () => {
    render(<App />);
    await plan();
    const stops = () =>
      within(screen.getByRole('list', { name: 'Route stops' })).getAllByRole('listitem');
    const items = stops();
    const originalOrder = items.map((item) => item.getAttribute('data-stop-id'));
    fireEvent.dragStart(items[0].querySelector('[draggable]')!, {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'move' },
    });
    fireEvent.drop(items[1]);
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    expect(provider.calculateRoute.mock.calls[1][0][0].coordinate).toEqual([11.41, 47.27]);
    expect(screen.getByRole('button', { name: 'Move stop 1 down' })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(stops().map((item) => item.getAttribute('data-stop-id'))).toEqual(originalOrder);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(stops()).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(stops().map((item) => item.getAttribute('data-stop-id'))).toEqual(originalOrder);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(stops().map((item) => item.getAttribute('data-stop-id'))).toEqual(
      [...originalOrder].reverse(),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(provider.calculateRoute).toHaveBeenCalledTimes(2);
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
    expect(
      within(screen.getByRole('list', { name: 'Route stops' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Point to point' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Round trip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to round trip' }));
    expect(
      within(screen.getByRole('list', { name: 'Route stops' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
  it('plans, saves, opens its library and reopens a persistent route', async () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: 'View all route tags' })).not.toBeInTheDocument();
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
    await routeDb.routes.update(saved.id, {
      tags: ['Scenic', 'Weekend', 'Forest', 'Water', 'Quiet'],
    });
    cleanup();
    render(<App />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    const open = await screen.findByRole('button', { name: /River escape Cycling/ });
    fireEvent.click(open);
    expect(screen.getByRole('heading', { name: 'River escape' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    const tags = screen.getByRole('button', { name: 'View all route tags' });
    expect(tags).toHaveTextContent('ScenicWeekendForest+2');
    fireEvent.click(tags);
    const details = screen.getByRole('dialog', { name: 'Route details' });
    expect(within(details).getByRole('list')).toHaveTextContent('ScenicWeekendForestWaterQuiet');
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
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
  it('never leaves stale geometry exportable on failed recalculation', async () => {
    render(<App />);
    await plan();
    provider.calculateRoute.mockRejectedValueOnce(new Error('Routing quota reached.'));
    addCoordinate('47.28, 11.42');
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(screen.getByTestId('map')).toHaveAttribute('data-segments', '1');
    expect(
      screen.getByText(
        'Previous route shown. Recalculate successfully before saving or exporting.',
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
  it('validates coordinate bounds without calling a service', () => {
    render(<App />);
    addCoordinate('999, 20');
    expect(screen.getByRole('alert')).toHaveTextContent('Latitude must be between −90 and 90.');
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });
  it('requires confirmation before discarding an unsaved route', async () => {
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Unsaved changes');
    expect(screen.getByRole('dialog')).toHaveClass('compact');
    expect(screen.getByRole('button', { name: 'Discard changes' })).toHaveClass('danger');
    expect(screen.getByRole('button', { name: 'Discard changes' })).not.toHaveClass('primary');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
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
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Latitude' }), {
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
    fireEvent.blur(screen.getByLabelText('Personal speed (km/h)'));
    fireEvent.change(screen.getByLabelText('Stops (minutes)'), { target: { value: '20' } });
    fireEvent.keyDown(screen.getByLabelText('Stops (minutes)'), { key: 'Enter' });
    await waitFor(async () => {
      const stored = await routeDb.table('drafts').get('current');
      expect(stored?.snapshot.speeds.cycling).toBe(12);
      expect(stored?.snapshot.stopsMinutes).toBe(20);
    });
    unmount();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore draft' }));
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    expect(screen.getByLabelText('Personal speed (km/h)')).toHaveValue('12');
    expect(screen.getByLabelText('Stops (minutes)')).toHaveValue('20');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
  });
  it('warns about corrupt drafts without blocking the planner and deletes only drafts', async () => {
    await routeDb.table('drafts').put({ id: 'current', version: 999 });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('draft could not');
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toBeEnabled();
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
    fireEvent.change(screen.getByLabelText('Latitude'), {
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
    const speed = screen.getByLabelText('Personal speed (km/h)');
    fireEvent.focus(speed);
    fireEvent.change(speed, { target: { value: '' } });
    fireEvent.keyDown(speed, { key: 'Enter' });
    expect(speed).toHaveValue('');
    expect(speed).toHaveAttribute('aria-invalid', 'true');
    await waitFor(async () =>
      expect((await routeDb.table('drafts').get('current'))?.snapshot.speeds.cycling).toBe(18),
    );
    fireEvent.change(speed, { target: { value: '6' } });
    fireEvent.blur(speed);
    fireEvent.change(screen.getByLabelText('Stops (minutes)'), { target: { value: '10' } });
    fireEvent.blur(screen.getByLabelText('Stops (minutes)'));
    expect(await screen.findByText('Total time with stops')).toBeInTheDocument();
    expect(screen.getByText('Provider estimate')).toBeInTheDocument();
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

describe('map and routing improvements', () => {
  it('remembers a closed elevation profile across recalculation and history', async () => {
    await i18n.changeLanguage('en');
    provider.calculateRoute.mockResolvedValue({
      segments: [geometry],
      stats: { distance: 1342, duration: 480, ascent: 30, descent: 15 },
      elevationSource: 'openrouteservice',
    });
    render(<App />);
    await plan();
    fireEvent.click(screen.getByText('Elevation profile').closest('summary')!);
    expect(screen.getByText('Elevation profile').closest('details')).not.toHaveAttribute('open');
    expect(provider.calculateRoute).toHaveBeenCalledOnce();
    addCoordinate('47.28, 11.42');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    expect(screen.getByText('Elevation profile').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Elevation profile').closest('details')).not.toHaveAttribute('open');
  });
  it('links map selection to the stop card without entering replacement mode', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Select first map point' }));
    const start = screen.getByRole('button', { name: /^Start 47/ });
    expect(start).toHaveAttribute('aria-pressed', 'true');
    expect(start.closest('li')).toHaveClass('selected-stop');
    expect(
      screen.queryByRole('button', { name: 'Replace stop coordinates' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Finish 47/ }));
    expect(screen.getByRole('button', { name: /^Finish 47/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace first map point' }));
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Replace stop coordinates' })).toBeVisible();
  });

  it('keeps previous geometry visible but unusable until the newest calculation succeeds', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    const previous = screen.getByTestId('map').getAttribute('data-geometry');
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
    addCoordinate('47.28, 11.42');
    expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', previous);
    expect(screen.getByTestId('map')).toHaveAttribute('data-stale', 'true');
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    await act(async () =>
      resolve({ segments: [geometry], stats: { distance: 1500, duration: 500 } }),
    );
    expect(screen.getByTestId('map')).toHaveAttribute('data-stale', 'false');
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
  });

  it('requests cycling preferences and offers point alternatives only for two automatic stops', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    choosePlannerOption('Cycling route profile', 'Road cycling');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Avoid ferries' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    expect(provider.calculateRoute.mock.calls[1][3]).toMatchObject({
      cyclingProfile: 'cycling-road',
      avoidFerries: true,
    });
    provider.calculatePointAlternatives.mockResolvedValueOnce([
      { segments: [geometry], stats: { distance: 1000, duration: 300 } },
      {
        segments: [
          [
            [11.4, 47.26],
            [11.42, 47.27],
            [11.41, 47.27],
          ],
        ],
        stats: { distance: 1300, duration: 400 },
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }));
    await waitFor(() => expect(provider.calculatePointAlternatives).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: /Option 1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /Option 2/ }));
    expect(screen.getByRole('button', { name: /Option 2/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByRole('button', { name: /^(Start|Finish) 47/ })).toHaveLength(2);
    addCoordinate('47.28, 11.42');
    expect(screen.getByRole('button', { name: 'Find alternatives' })).toBeDisabled();
  });

  it('preserves direct section meaning when reversing stops and undoing', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    addCoordinate('47.28, 11.42');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    choosePlannerOption('Section 2 mode', 'Direct line — unverified');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    expect(screen.getByRole('button', { name: 'Section 1 mode' })).toHaveTextContent(
      'Direct line — unverified',
    );
    expect(screen.getByRole('button', { name: 'Section 2 mode' })).toHaveTextContent(
      'Road/path routing',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Section 2 mode' })).toHaveTextContent(
      'Direct line — unverified',
    );
  });
});
